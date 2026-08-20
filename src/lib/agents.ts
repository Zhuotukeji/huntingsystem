import { createHash, randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";
import { createAiRun, executeAiRun } from "@/lib/learning";
import { generateResearchSteps } from "@/lib/llm";
import { createTask, getCampaign, importSource } from "@/lib/repository";

type CsvRecord = Record<string, string>;

export function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if ((character === "," || character === "\t") && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export async function discoverOrganizations(campaignId: string) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("战役不存在");
  const run = await executeAiRun(createAiRun({ campaignId, runType: "MANUAL", triggeredBy: "公司发现页面" }).id);
  return createTask({
    campaignId,
    type: "RESUME_GRAPH_LEARNING",
    status: run.status === "FAILED" ? "FAILED" : "WAITING_REVIEW",
    title: `图谱增量学习 · ${campaign.name}`,
    resultSummary: run.summary,
    payload: { aiRunId: run.id },
    steps: ["分析新增或变化简历", "更新公司与人才实体", "重建任职和技能关系", "生成 BOSS 人工搜索任务"],
  });
}

export async function discoverPeople(campaignId: string) {
  return discoverOrganizations(campaignId);
}

export async function createInsightTrackerTask(campaignId: string) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("战役不存在");
  const fallbackSteps = [
    `市场筛选：${campaign.markets.join("、") || "按岗位画像"}`,
    `渠道关键词：${campaign.channels.join(" / ") || "Google / Meta / TikTok / SEO"}`,
    "优先记录产品名、公司主体、市场、获客渠道和变现模式",
    "保留平台允许使用的链接、截图、导出文件或原文摘录",
    "回到“调研导入”页面上传文件或粘贴文本",
  ];
  const steps = await generateResearchSteps(campaign, fallbackSteps);
  return createTask({ campaignId, type: "MANUAL_INSIGHTTRACKER_RESEARCH", status: "WAITING_HUMAN", title: `InsightTracker 调研 · ${campaign.name}`, resultSummary: "已生成调研指令，等待 HR 在授权账号中执行并导入结果。", payload: { markets: campaign.markets, channels: campaign.channels, target: 20 }, steps });
}

function getField(record: CsvRecord, names: string[]) {
  for (const name of names) if (record[name]) return record[name];
  return "";
}

export function processImport(input: { campaignId: string; provider: string; title: string; sourceUrl?: string; text: string }) {
  const records = parseCsv(input.text);
  const source = importSource({ ...input, importedCount: records.length });
  if (source.duplicate) return { duplicate: true, imported: 0 };
  let imported = 0;
  const timestamp = now();
  for (const record of records.slice(0, 500)) {
    const name = getField(record, ["company", "company_name", "公司", "公司名称", "name"]);
    if (!name) continue;
    const domain = getField(record, ["website", "domain", "官网"]);
    const normalized = name.toLowerCase().replace(/[\s.,，。()（）_-]/g, "");
    const existing = db.prepare("SELECT id FROM organizations WHERE normalized_name = ? OR (? <> '' AND domain = ?)").get(normalized, domain, domain) as { id: string } | undefined;
    const organizationId = existing?.id || randomUUID();
    if (!existing) db.prepare("INSERT INTO organizations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(organizationId, name, normalized, domain, getField(record, ["location", "地区"]) || "待确认", getField(record, ["size", "规模"]) || "待确认", "由 HR 导入，等待简历证据与人工补充。", 0.8, timestamp);
    if (db.prepare("SELECT 1 FROM campaign_organizations WHERE campaign_id = ? AND organization_id = ?").get(input.campaignId, organizationId)) continue;
    const values = (names: string[]) => getField(record, names).split(/[|/、;]/).map((item) => item.trim()).filter(Boolean);
    const evidenceText = getField(record, ["evidence", "证据", "note", "备注"]) || `HR 从 ${input.provider} 导入了 ${name} 的公司线索。`;
    db.prepare(`INSERT INTO campaign_organizations (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json, fit_score, evidence_coverage, confidence, recommendation_reason, unknowns_json, owner_name, updated_at) VALUES (?, ?, ?, '人工导入', 'PENDING_REVIEW', ?, ?, ?, ?, 65, 45, 80, '人工导入线索，建议补充简历证据后审核。', '["业务规模待验证","核心人才待发现"]', '待分配', ?)`)
      .run(randomUUID(), input.campaignId, organizationId, JSON.stringify(values(["product", "产品"])), JSON.stringify(values(["market", "市场"])), JSON.stringify(values(["channel", "渠道"])), JSON.stringify(values(["monetization", "变现"])), timestamp);
    db.prepare("INSERT INTO evidence VALUES (?, 'ORGANIZATION', ?, 'FACT', ?, ?, ?, ?, ?, 0.7, ?)").run(randomUUID(), organizationId, evidenceText, evidenceText, input.title, input.sourceUrl || "", input.provider, timestamp);
    imported += 1;
  }
  createTask({ campaignId: input.campaignId, type: "IMPORT_SOURCE", status: "WAITING_REVIEW", title: `解析导入 · ${input.title}`, resultSummary: records.length ? `解析 ${records.length} 行，新增 ${imported} 家公司，重复项已跳过。` : "资料已保存为来源，未检测到结构化 CSV 行。", steps: ["内容哈希去重", "解析结构化字段", "公司实体消歧", "创建证据与审核队列"] });
  return { duplicate: false, imported };
}

export function sourceFingerprint(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}
