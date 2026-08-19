import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";
import { createTask, getCampaign, importSource, updateTask } from "@/lib/repository";
import { generateResearchSteps } from "@/lib/llm";

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

const generatedCompanies = [
  {
    id: "org-polaris", name: "极星数字", domain: "polaris-demo.example", location: "深圳", size: "80-200人", category: "直接竞对", fit: 90, coverage: 82, confidence: 93,
    products: ["Polaris Go"], markets: ["欧美", "东南亚"], channels: ["Meta", "TikTok", "Google"], monetization: ["广告", "联盟营销"],
    reason: "海外流量获取与广告变现链路完整，近期团队扩张信号明确。", unknowns: ["利润规模待验证", "负责人汇报关系未知"],
  },
  {
    id: "org-keystone", name: "基石出海", domain: "keystone-demo.example", location: "广州", size: "50-120人", category: "同变现", fit: 85, coverage: 74, confidence: 91,
    products: ["KeyWave"], markets: ["东南亚"], channels: ["TikTok", "Google"], monetization: ["广告"],
    reason: "东南亚产品矩阵和变现模式匹配，可作为区域负责人人才来源。", unknowns: ["欧美市场经验未知"],
  },
  {
    id: "org-meridian", name: "经纬增长", domain: "meridian-demo.example", location: "杭州", size: "150-400人", category: "同渠道", fit: 80, coverage: 68, confidence: 88,
    products: ["Meridian Labs"], markets: ["欧美", "拉美"], channels: ["SEO", "Google"], monetization: ["订阅", "广告"],
    reason: "搜索增长能力突出，业务负责人与增长负责人的能力具有迁移价值。", unknowns: ["广告业务成熟度", "广州办公意愿"],
  },
] as const;

export function discoverOrganizations(campaignId: string) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("战役不存在");
  const task = createTask({ campaignId, type: "DISCOVER_ORGANIZATIONS", status: "RUNNING", title: `公司发现 · ${campaign.name}`, steps: ["读取已确认公司画像", "生成受控检索假设", "解析授权导入来源", "实体去重与证据验证", "透明评分"] });
  let inserted = 0;
  const timestamp = now();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const company of generatedCompanies) {
      const exists = db.prepare("SELECT 1 FROM campaign_organizations WHERE campaign_id = ? AND organization_id = ?").get(campaignId, company.id);
      if (exists) continue;
      db.prepare("INSERT OR IGNORE INTO organizations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(company.id, company.name, company.name.toLowerCase(), company.domain, company.location, company.size, company.reason, company.confidence / 100, timestamp);
      db.prepare(`INSERT INTO campaign_organizations (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json, fit_score, evidence_coverage, confidence, recommendation_reason, unknowns_json, owner_name, updated_at) VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, '待分配', ?)`)
        .run(randomUUID(), campaignId, company.id, company.category, JSON.stringify(company.products), JSON.stringify(company.markets), JSON.stringify(company.channels), JSON.stringify(company.monetization), company.fit, company.coverage, company.confidence, company.reason, JSON.stringify(company.unknowns), timestamp);
      db.prepare("INSERT INTO evidence VALUES (?, 'ORGANIZATION', ?, 'FACT', ?, ?, '合规导入的公司研究材料', '', 'HR 导入', ?, ?)")
        .run(randomUUID(), company.id, `${company.name}在${company.markets.join("、")}运营${company.products.join("、")}`, `来源材料记录渠道：${company.channels.join("、")}；变现：${company.monetization.join("、")}`, company.coverage / 100, timestamp);
      db.prepare("INSERT INTO evidence VALUES (?, 'ORGANIZATION', ?, 'INFERENCE', ?, ?, 'AI 匹配分析', '', 'System', ?, ?)")
        .run(randomUUID(), company.id, company.reason, "这是基于已确认事实形成的推荐判断，等待 HR 审核。", company.fit / 100 - 0.05, timestamp);
      inserted += 1;
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); updateTask(task.id, "FAILED", error instanceof Error ? error.message : "公司发现失败"); throw error; }

  return updateTask(task.id, "WAITING_REVIEW", inserted ? `新增 ${inserted} 家可审核公司，已完成去重与证据评分。` : "本轮没有新增公司，重复结果已被去重。")!;
}

const generatedPeople = [
  ["person-qiao", "乔宁", "海外业务副总｜产品与商业化", "广州", "业务负责人 / GM", 91, 81, 94, ["负责海外产品与商业化闭环", "搭建跨职能团队"], ["当前业绩规模", "换岗动机"]],
  ["person-song", "宋一", "海外增长负责人｜多渠道获客", "深圳", "海外增长负责人", 88, 76, 91, ["Google、Meta 与 TikTok 组合增长", "有区域市场落地经验"], ["P&L 深度", "团队管理范围"]],
  ["person-luo", "罗森", "商业化 Lead｜广告变现", "杭州", "商业化 / 变现负责人", 85, 73, 89, ["广告变现策略与产品协同", "欧美市场经验"], ["异地意愿", "完整任职时间"]],
] as const;

export function discoverPeople(campaignId: string) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("战役不存在");
  const approved = db.prepare("SELECT organization_id FROM campaign_organizations WHERE campaign_id = ? AND status = 'APPROVED' ORDER BY fit_score DESC").all(campaignId) as Array<{ organization_id: string }>;
  if (!approved.length) throw new Error("请先批准至少一家目标公司");
  const task = createTask({ campaignId, type: "DISCOVER_PERSONS", status: "RUNNING", title: `人员发现 · ${campaign.name}`, steps: ["读取已批准公司", "展开职位同义词与人员槽位", "核验任职关系", "身份消歧", "生成候选人证据卡"] });
  let inserted = 0;
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    generatedPeople.forEach((person, index) => {
      const [id, name, headline, location, slot, fit, coverage, identity, strengths, unknowns] = person;
      if (db.prepare("SELECT 1 FROM campaign_people WHERE campaign_id = ? AND person_id = ?").get(campaignId, id)) return;
      const organizationId = approved[index % approved.length].organization_id;
      db.prepare("INSERT OR IGNORE INTO people VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, name, name.toLowerCase(), headline, location, identity / 100, timestamp);
      db.prepare(`INSERT INTO campaign_people (id, campaign_id, person_id, organization_id, slot, status, fit_score, evidence_coverage, identity_confidence, recommendation_reason, strengths_json, unknowns_json, risk_flags_json, owner_name, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, '[]', '待分配', ?)`)
        .run(randomUUID(), campaignId, id, organizationId, slot, fit, coverage, identity, `${name}与“${slot}”槽位匹配，建议 HR 优先核验未知项。`, JSON.stringify(strengths), JSON.stringify(unknowns), timestamp);
      db.prepare("INSERT INTO evidence VALUES (?, 'PERSON', ?, 'FACT', ?, ?, 'HR 合规导入的公开履历', '', 'HR 导入', ?, ?)")
        .run(randomUUID(), id, strengths[0], `公开资料支持：${strengths.join("；")}`, coverage / 100, timestamp);
      db.prepare("INSERT INTO evidence VALUES (?, 'PERSON', ?, 'INFERENCE', ?, '需在首次沟通中核实岗位边界与成果归因。', 'AI 能力映射', '', 'System', ?, ?)")
        .run(randomUUID(), id, `可能适配${slot}`, fit / 100 - 0.06, timestamp);
      inserted += 1;
    });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); updateTask(task.id, "FAILED", error instanceof Error ? error.message : "人员发现失败"); throw error; }
  return updateTask(task.id, "WAITING_REVIEW", inserted ? `新增 ${inserted} 名人选，事实、推测和未知项已分层。` : "本轮没有新增人选，重复档案已被去重。")!;
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
  return createTask({
    campaignId,
    type: "MANUAL_INSIGHTTRACKER_RESEARCH",
    status: "WAITING_HUMAN",
    title: `InsightTracker 调研 · ${campaign.name}`,
    resultSummary: "已生成调研指令，等待 HR 在授权账号中执行并导入结果。",
    payload: { markets: campaign.markets, channels: campaign.channels, target: 20 },
    steps,
  });
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
    const existing = db.prepare("SELECT id FROM organizations WHERE normalized_name = ? OR (? <> '' AND domain = ?)").get(name.toLowerCase(), domain, domain) as { id: string } | undefined;
    const organizationId = existing?.id || randomUUID();
    if (!existing) {
      db.prepare("INSERT INTO organizations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(organizationId, name, name.toLowerCase(), domain, getField(record, ["location", "地区"]) || "待确认", getField(record, ["size", "规模"]) || "待确认", "由 HR 导入，等待 AI 与人工共同补充。", 0.8, timestamp);
    }
    const existsInCampaign = db.prepare("SELECT 1 FROM campaign_organizations WHERE campaign_id = ? AND organization_id = ?").get(input.campaignId, organizationId);
    if (existsInCampaign) continue;
    const values = (names: string[]) => getField(record, names).split(/[|/、;]/).map((item) => item.trim()).filter(Boolean);
    const evidenceText = getField(record, ["evidence", "证据", "note", "备注"]) || `HR 从 ${input.provider} 导入了 ${name} 的公司线索。`;
    db.prepare(`INSERT INTO campaign_organizations (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json, fit_score, evidence_coverage, confidence, recommendation_reason, unknowns_json, owner_name, updated_at) VALUES (?, ?, ?, '人工导入', 'PENDING_REVIEW', ?, ?, ?, ?, 65, 45, 80, '人工导入线索，建议补充证据后审核。', '["业务规模待验证","核心人才待发现"]', '待分配', ?)`)
      .run(randomUUID(), input.campaignId, organizationId, JSON.stringify(values(["product", "产品"])), JSON.stringify(values(["market", "市场"])), JSON.stringify(values(["channel", "渠道"])), JSON.stringify(values(["monetization", "变现"])), timestamp);
    db.prepare("INSERT INTO evidence VALUES (?, 'ORGANIZATION', ?, 'FACT', ?, ?, ?, ?, ?, 0.7, ?)")
      .run(randomUUID(), organizationId, evidenceText, evidenceText, input.title, input.sourceUrl || "", input.provider, timestamp);
    imported += 1;
  }
  createTask({ campaignId: input.campaignId, type: "IMPORT_SOURCE", status: "WAITING_REVIEW", title: `解析导入 · ${input.title}`, resultSummary: records.length ? `解析 ${records.length} 行，新增 ${imported} 家公司，重复项已跳过。` : "资料已保存为来源，未检测到结构化 CSV 行。", steps: ["内容哈希去重", "解析结构化字段", "公司实体消歧", "创建证据与审核队列"] });
  return { duplicate: false, imported };
}
