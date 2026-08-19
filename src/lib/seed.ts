import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/db";

const stamp = now();
const campaignId = "campaign-overseas-gm";

function insertEvidence(
  entityType: "ORGANIZATION" | "PERSON",
  entityId: string,
  classification: "FACT" | "INFERENCE" | "CONFLICT",
  claimText: string,
  quote: string,
  sourceTitle: string,
  sourceProvider: string,
  confidence: number,
) {
  db.prepare(`INSERT INTO evidence
    (id, entity_type, entity_id, classification, claim_text, quote, source_title, source_url, source_provider, confidence, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), entityType, entityId, classification, claimText, quote, sourceTitle, "", sourceProvider, confidence, stamp);
}

export function seedDatabase(force = false) {
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM campaigns").get() as { count: number }).count);
  if (count > 0 && !force) return;

  if (force) {
    db.exec("DELETE FROM feedback; DELETE FROM sources; DELETE FROM tasks; DELETE FROM evidence; DELETE FROM campaign_people; DELETE FROM people; DELETE FROM campaign_organizations; DELETE FROM organizations; DELETE FROM campaigns;");
  }

  db.prepare(`INSERT INTO campaigns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      campaignId,
      "海外项目负责人寻访",
      "海外项目负责人 / General Manager",
      "ACTIVE",
      "陈晨",
      "在 12 个月内建立海外广告变现业务，完成从 0 到 1 的团队和收入验证。",
      "独立业务决策权、成熟供应链资源、核心团队搭建空间。",
      JSON.stringify(["广州", "深圳", "杭州", "远程"]),
      JSON.stringify(["欧美", "东南亚"]),
      JSON.stringify(["Google", "Meta", "TikTok", "SEO"]),
      JSON.stringify(["有海外业务 P&L 或项目全盘经验", "带领 8 人以上跨职能团队", "熟悉广告或联盟变现"]),
      JSON.stringify(["0 到 1 产品经验", "有东南亚市场落地经验"]),
      JSON.stringify(["纯代运营背景", "无可验证海外业务经历"]),
      100,
      150,
      20,
      stamp,
      stamp,
    );

  const companies = [
    ["org-northstar", "北辰互动", "northstar-demo.example", "广州", "100-300人", "直接竞对", 92, 88, 94, ["SparkReach", "NovaPlay"], ["欧美", "东南亚"], ["Google", "Meta", "TikTok"], ["广告", "联盟营销"], "业务模式与市场高度重合，公开案例显示已形成投放、产品和商业化闭环。", ["海外业务利润规模待验证"]],
    ["org-tide", "潮汐科技", "tide-demo.example", "深圳", "50-150人", "同渠道", 87, 76, 91, ["TideFlow"], ["欧美"], ["Google", "SEO"], ["广告", "订阅"], "同类获客渠道成熟，近期正在扩充海外增长与商业化岗位。", ["团队汇报线未知", "核心负责人姓名待确认"]],
    ["org-lantern", "远灯网络", "lantern-demo.example", "杭州", "100-500人", "相邻业务", 82, 71, 89, ["OrbitRead", "QuickMuse"], ["欧美", "拉美"], ["Meta", "TikTok"], ["订阅", "广告"], "内容产品出海经验可迁移，增长组织与目标岗位能力结构接近。", ["广告收入占比未知"]],
    ["org-reef", "礁石数据", "reef-demo.example", "广州", "50-100人", "上下游", 74, 84, 95, ["ReefMetric"], ["全球"], ["数据分析", "归因"], ["SaaS"], "服务多家出海客户，可作为人才迁移和行业关系扩展来源。", ["是否存在甲方业务负责人待验证"]],
    ["org-arc", "弧光游戏", "arc-demo.example", "深圳", "300-500人", "人才来源", 79, 63, 88, ["ArcQuest"], ["欧美", "日韩"], ["Meta", "TikTok"], ["内购", "广告"], "拥有大规模海外买量和商业化团队，人才能力具有迁移价值。", ["非游戏业务迁移意愿未知"]],
    ["org-canopy", "穹顶工作室", "canopy-demo.example", "远程", "30-80人", "同变现", 68, 58, 83, ["Canopy Apps"], ["东南亚"], ["TikTok"], ["广告"], "变现模型接近，但公司规模与业务成熟度证据不足。", ["主体公司信息待核实", "团队规模来源单一"]],
  ] as const;

  for (const row of companies) {
    const [id, name, domain, location, size, category, fit, coverage, confidence, products, markets, channels, monetization, reason, unknowns] = row;
    db.prepare("INSERT INTO organizations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, name.toLowerCase(), domain, location, size, reason, confidence / 100, stamp);
    db.prepare(`INSERT INTO campaign_organizations
      (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json, fit_score, evidence_coverage, confidence, recommendation_reason, unknowns_json, owner_name, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), campaignId, id, category, fit >= 87 ? "APPROVED" : "PENDING_REVIEW", JSON.stringify(products), JSON.stringify(markets), JSON.stringify(channels), JSON.stringify(monetization), fit, coverage, confidence, reason, JSON.stringify(unknowns), fit >= 87 ? "陈晨" : "待分配", stamp);
    insertEvidence("ORGANIZATION", id, "FACT", `${name}面向${markets.join("、")}市场运营${products.join("、")}`, `调研材料中记录的产品与目标市场：${products.join("、")} / ${markets.join("、")}`, "InsightTracker 人工调研摘录", "InsightTracker", coverage / 100);
    insertEvidence("ORGANIZATION", id, "INFERENCE", reason, "基于产品、招聘与渠道信号的综合判断，需由 HR 审核。", "AI 研究结论", "System", Math.max(0.6, fit / 100 - 0.08));
  }

  const people = [
    ["person-lin", "林哲", "海外业务负责人｜从 0 到 1 搭建增长与商业化团队", "广州", "org-northstar", "业务负责人 / GM", "READY_TO_CONTACT", 94, 86, 96, ["连续负责海外业务全盘", "公开材料可验证团队搭建", "渠道与变现经验完整"], ["当前换岗动机", "期望业务规模"], []],
    ["person-zhou", "周然", "海外增长负责人｜欧美市场", "深圳", "org-tide", "海外增长负责人", "PENDING_REVIEW", 89, 78, 92, ["熟悉 Google 与 SEO 组合增长", "有商业化协作经验"], ["是否直接承担 P&L", "团队规模"], []],
    ["person-tang", "唐可", "商业化负责人｜广告与订阅", "杭州", "org-lantern", "商业化 / 变现负责人", "NEEDS_RESEARCH", 84, 64, 87, ["广告与订阅混合变现", "海外内容产品经验"], ["完整任职时间线", "是否管理投放团队"], ["当前信息只有单一来源"]],
    ["person-xu", "许言", "海外发行与增长负责人", "深圳", "org-arc", "业务二号位", "PENDING_REVIEW", 81, 72, 90, ["大规模海外买量", "跨职能团队管理"], ["从游戏向非游戏迁移意愿"], []],
    ["person-he", "何川", "东南亚业务 Lead", "远程", "org-canopy", "区域负责人", "PENDING_REVIEW", 76, 55, 82, ["东南亚落地经验", "小团队 0 到 1"], ["主体公司", "收入规模", "履历连续性"], ["身份消歧仍需人工确认"]],
  ] as const;

  for (const row of people) {
    const [id, name, headline, location, organizationId, slot, status, fit, coverage, identity, strengths, unknowns, risks] = row;
    db.prepare("INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, name, name.toLowerCase(), headline, location, identity / 100, stamp);
    db.prepare(`INSERT INTO campaign_people
      (id, campaign_id, person_id, organization_id, slot, status, fit_score, evidence_coverage, identity_confidence, recommendation_reason, strengths_json, unknowns_json, risk_flags_json, owner_name, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), campaignId, id, organizationId, slot, status, fit, coverage, identity, `${name}的公开业务轨迹与“${slot}”槽位匹配，建议先验证未知项再决定触达。`, JSON.stringify(strengths), JSON.stringify(unknowns), JSON.stringify(risks), status === "READY_TO_CONTACT" ? "陈晨" : "王敏", stamp);
    insertEvidence("PERSON", id, "FACT", strengths[0], `公开活动资料提到：${strengths[0]}。`, "公开活动与招聘资料摘录", "HR 导入", coverage / 100);
    insertEvidence("PERSON", id, "INFERENCE", `能力可能适配${slot}`, "该结论由已确认经历映射到战役评价维度，尚未经过候选人本人确认。", "AI 匹配分析", "System", fit / 100 - 0.06);
  }

  const tasks = [
    ["task-insight", "MANUAL_INSIGHTTRACKER_RESEARCH", "WAITING_HUMAN", "补充 20 家同渠道公司", "请 HR 在 InsightTracker 完成本轮查询并导入结果。", ["筛选地区：广州、深圳、杭州", "渠道关键词：Google / Meta / TikTok / SEO", "记录产品、市场、变现方式和可验证来源", "导出允许使用的文件或粘贴摘录"]],
    ["task-org", "DISCOVER_ORGANIZATIONS", "WAITING_REVIEW", "首轮公司发现", "已产出 6 家公司，其中 2 家已批准。", ["生成 12 个受控查询假设", "解析 18 条人工导入记录", "公司实体去重", "完成证据覆盖和透明评分"]],
    ["task-person", "DISCOVER_PERSONS", "WAITING_REVIEW", "已批准公司的人员发现", "已产出 5 名人选，1 人可联系、1 人待补充研究。", ["按 5 类人员槽位生成查询", "核验任职关系", "完成人物消歧", "生成证据卡"]],
  ] as const;

  for (const [id, type, status, title, result, steps] of tasks) {
    db.prepare(`INSERT INTO tasks
      (id, campaign_id, type, status, title, result_summary, payload_json, steps_json, attempts, max_attempts, model_name, estimated_cost, idempotency_key, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, campaignId, type, status, title, result, "{}", JSON.stringify(steps), 1, 3, "demo-agent-v1", 0, id, stamp, status === "WAITING_HUMAN" ? null : stamp);
  }
}

if (process.env.DEMO_MODE !== "false") seedDatabase();
