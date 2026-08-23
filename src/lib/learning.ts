import { createHash, randomUUID } from "node:crypto";
import { db, json, now } from "@/lib/db";
import { analyzeResumeWithAi, type ResumeAnalysis } from "@/lib/llm";
import { canTransitionPersonStatus, PERSON_STATUS_LABELS } from "@/lib/person-workflow";
import { getCampaign, listCampaigns } from "@/lib/repository";
import { preferredCandidateName, resolveResumeIdentity, type ResumeIdentityResolution } from "@/lib/resume-identity";
import { getPendingResumeIds, getResumeText, isResumeQualityRestored } from "@/lib/resumes";
import { getAutonomySettings, getCandidateAutomationSettings, matchCandidateAutoProgressRule } from "@/lib/settings";
import { assessResumeTextPreflight, evaluateResumeQuality, type ResumeQualityAssessment } from "@/lib/resume-quality";
import { assignExperimentToSearchTask, attachCandidateOrigin, createResearchTask, ensureActiveStrategyVersion, recordActivityEvent } from "@/lib/autonomy";
import type { AiRun, GraphData, LearningRecommendation, OrganizationBusinessStatus, PersonStatus, ResumeQualityPolicy, ResumeStatus, SearchTask } from "@/lib/types";

type Row = Record<string, string | number | null>;

const PARSE_VERSION = "resume-graph-v3-quality-gated";
const searchTaskLifetimeDays = 14;
const learningCandidateStatuses = new Set<PersonStatus>(["PENDING_REVIEW", "NEEDS_RESEARCH"]);
const bossSearchInstructions = [
  "先使用公司名与一个宽泛职位词搜索，不要同时叠加多个关键词",
  "地区和经验使用 BOSS 筛选项单独设置",
  "结果少于 20 条时，先放宽地区或只保留职位词",
  "完成后填写结果数、合格数和有效沟通数",
];
const broadKeywordRules: Array<[RegExp, string]> = [
  [/广告.*变现|变现.*广告/i, "广告变现"],
  [/(海外|出海|国际).*(投放|广告)|(投放|广告).*(海外|出海|国际)/i, "海外投放"],
  [/(海外|出海|国际).*增长|增长.*(海外|出海|国际)/i, "海外增长"],
  [/(海外|出海|国际).*(市场|营销)|(市场|营销).*(海外|出海|国际)/i, "海外市场"],
  [/(海外|出海|国际).*(销售|商务)|(销售|商务).*(海外|出海|国际)/i, "海外销售"],
  [/商业化|变现|monetization/i, "商业化"],
  [/广告|投放|优化师|performance marketing/i, "广告投放"],
  [/跨境电商|电商|e-?commerce/i, "电商"],
  [/客户成功|customer success/i, "客户成功"],
  [/产品|product/i, "产品"],
  [/运营|operation/i, "运营"],
  [/销售|sales/i, "销售"],
  [/商务|\bBD\b|business development/i, "商务"],
  [/市场|营销|marketing/i, "市场"],
  [/数据|\bdata\b/i, "数据"],
  [/算法|algorithm/i, "算法"],
  [/前端|front.?end/i, "前端开发"],
  [/后端|back.?end/i, "后端开发"],
  [/\bjava\b/i, "Java开发"],
  [/技术|研发|工程|developer|engineer/i, "技术"],
  [/人力|招聘|\bHR\b|recruit/i, "人力资源"],
  [/财务|finance/i, "财务"],
  [/法务|legal/i, "法务"],
  [/供应链|采购|supply chain/i, "供应链"],
  [/设计|designer/i, "设计"],
  [/(海外|出海|国际|global|international)/i, "海外业务"],
  [/管理|负责人|经理|总监|主管|head|manager|director|leader/i, "管理"],
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s·•.,，。()（）\[\]【】_-]/g, "").replace(/(有限责任公司|股份有限公司|有限公司|科技|网络)$/g, "");
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function fallbackSearchKeyword(value: string) {
  const segment = value.split(/[\/|｜、,，;；()（）]/).map((item) => item.trim()).find(Boolean) || "";
  const compact = segment
    .replace(/^(高级|资深|首席|初级|Senior|Lead)\s*/i, "")
    .replace(/(总负责人|负责人|高级经理|经理|总监|主管|组长|专家|优化师|工程师|顾问|专员|General Manager|Head|Manager|Director|Leader)$/i, "")
    .replace(/\s+/g, "")
    .trim();
  const characters = [...compact];
  return characters.length > 8 ? characters.slice(-8).join("") : compact;
}

export function compactBossSearchKeywords(values: string[]) {
  const keywords: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const matches = broadKeywordRules.filter(([pattern]) => pattern.test(value)).map(([, keyword]) => keyword);
    const candidates = matches.length ? matches.slice(0, 2) : [fallbackSearchKeyword(value)];
    for (const keyword of candidates) {
      if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
      if (keywords.length === 3) return keywords;
    }
  }
  return keywords;
}

function aiRunFrom(row: Row): AiRun {
  return {
    id: String(row.id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    campaignName: row.campaign_name ? String(row.campaign_name) : null,
    runType: row.run_type as AiRun["runType"],
    businessDate: row.business_date ? String(row.business_date) : null,
    status: row.status as AiRun["status"],
    stage: String(row.stage),
    scope: json(String(row.scope_json)),
    summary: String(row.summary),
    metrics: json(String(row.metrics_json)),
    errorMessage: String(row.error_message),
    triggeredBy: String(row.triggered_by),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function searchTaskFrom(row: Row): SearchTask {
  const query = json<SearchTask["query"]>(String(row.query_json));
  return {
    id: String(row.id), campaignId: String(row.campaign_id), campaignName: String(row.campaign_name || ""), runId: row.run_id ? String(row.run_id) : null,
    taskType: String(row.task_type), title: String(row.title), companyName: String(row.company_name), query: { ...query, keywords: compactBossSearchKeywords(query.keywords || []), experience: "结果充足后再优先筛选 5 年以上或负责人经历", instructions: bossSearchInstructions }, reason: json(String(row.reason_json)),
    priority: Number(row.priority), status: row.status as SearchTask["status"], claimedBy: row.claimed_by ? String(row.claimed_by) : null,
    expiresAt: String(row.expires_at), createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    experimentAssignmentId: row.experiment_assignment_id ? String(row.experiment_assignment_id) : null,
  };
}

function recommendationFrom(row: Row): LearningRecommendation {
  return {
    id: String(row.id), campaignId: String(row.campaign_id), runId: row.run_id ? String(row.run_id) : null,
    recommendationType: String(row.recommendation_type), title: String(row.title), reason: String(row.reason), payload: json(String(row.payload_json)),
    confidence: Number(row.confidence), status: row.status as LearningRecommendation["status"], createdAt: String(row.created_at),
  };
}

type ResumeRunState = {
  campaign_id: string;
  person_id: string | null;
  resume_status: ResumeStatus;
  campaign_person_id: string | null;
  candidate_status: string | null;
  person_name: string | null;
};

function getResumeRunState(resumeId: string) {
  return db.prepare(`SELECT rd.campaign_id, rd.person_id, rd.status AS resume_status,
    cp.id AS campaign_person_id, cp.status AS candidate_status, p.name AS person_name
    FROM resume_documents rd
    LEFT JOIN campaign_people cp ON cp.campaign_id = rd.campaign_id AND cp.person_id = rd.person_id
    LEFT JOIN people p ON p.id = rd.person_id
    WHERE rd.id = ?`).get(resumeId) as ResumeRunState | undefined;
}

function isAdvancedResumeCandidate(state: ResumeRunState) {
  return Boolean(state.campaign_person_id && state.candidate_status && !learningCandidateStatuses.has(state.candidate_status as PersonStatus));
}

function markAdvancedResumeSkipped(runId: string, resumeId: string, state: ResumeRunState, restoreResumeStatus?: string) {
  const completedAt = now();
  if (restoreResumeStatus) {
    db.prepare("UPDATE resume_documents SET status = ?, error_message = '' WHERE id = ?").run(restoreResumeStatus, resumeId);
  }
  db.prepare("UPDATE ai_run_items SET status = 'SKIPPED', result_json = ?, error_message = '', completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?")
    .run(JSON.stringify({ reason: "CANDIDATE_ALREADY_ADVANCED", personId: state.person_id, personName: state.person_name, candidateStatus: state.candidate_status }), completedAt, runId, resumeId);
}

function chinaBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function fallbackResumeAnalysis(text: string, campaignId: string): ResumeAnalysis {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error("人才画像不存在");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const field = (names: string[]) => {
    for (const line of lines) {
      const match = line.match(new RegExp(`^(?:${names.join("|")})[：:]\\s*(.+)$`, "i"));
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  const personName = field(["姓名", "name"]);
  if (!personName) throw new Error("未配置 AI 时，简历需包含“姓名：”字段才能安全解析");
  const headline = field(["职位", "岗位", "title", "headline"]) || campaign.roleName;
  const location = field(["所在地", "城市", "location"]);
  const employments: ResumeAnalysis["employments"] = [];
  const employmentPattern = /^(?:(\d{4}[./-]\d{1,2}|\d{4}|至今|present)\s*[-—~至]\s*(\d{4}[./-]\d{1,2}|\d{4}|至今|present)\s*[|｜,，]\s*)?([^|｜,，]{2,80})\s*[|｜,，]\s*([^|｜,，]{2,80})(?:\s*[|｜,，]\s*(.*))?$/i;
  for (const line of lines) {
    const match = line.match(employmentPattern);
    if (!match || /^(姓名|职位|岗位|所在地|城市|技能|name|title|location)/i.test(line)) continue;
    const company = match[3]?.trim();
    const title = match[4]?.trim();
    if (!company || !title) continue;
    const isCurrent = /至今|present/i.test(match[2] || "");
    const summary = match[5]?.trim() || "";
    employments.push({
      company, aliases: [], title, normalizedRole: title, startDate: match[1] || null, endDate: match[2] || null, isCurrent, summary,
      evidenceQuote: line,
      location: "", industry: "", businessTags: [], markets: [], channels: [], monetization: [],
      businessHistory: !isCurrent && summary ? [summary] : [], currentBusiness: isCurrent && summary ? [summary] : [],
      businessStatus: "UNKNOWN", businessStatusSummary: "简历未提供足够的经营指标，暂不判断业务状态。", businessSignals: [], businessStatusConfidence: 0,
      confidence: 0.72,
    });
  }
  const sourceSkills = field(["技能", "skills"]).split(/[、,，/|；;]/).map((item) => item.trim()).filter(Boolean);
  const campaignSignals = [...campaign.channels, ...campaign.markets, ...campaign.mustHaves, ...campaign.niceToHaves];
  const matchedSignals = campaignSignals.filter((signal) => text.toLowerCase().includes(signal.toLowerCase()));
  const skills = [...new Set([...sourceSkills, ...matchedSignals])].slice(0, 30).map((name) => ({ name, category: "OTHER" as const, evidence: lines.find((line) => line.includes(name)) || name, confidence: 0.7 }));
  const mustHit = campaign.mustHaves.filter((item) => text.includes(item) || item.split(/[、， /]/).some((part) => part.length > 2 && text.includes(part))).length;
  const score = campaign.mustHaves.length ? Math.round(45 + (mustHit / campaign.mustHaves.length) * 45) : 65;
  return { person: { name: personName, headline, location, summary: field(["简介", "summary"]) }, employments, skills, match: { score, strengths: matchedSignals.slice(0, 8), gaps: campaign.mustHaves.filter((item) => !matchedSignals.includes(item)).slice(0, 8), rationale: "Sub2API 未启用，当前分数仅来自简历关键词与画像的确定性匹配，建议人工复核。" } };
}

export function createAiRun(input: { campaignId?: string; runType?: AiRun["runType"]; resumeIds?: string[]; triggeredBy?: string; businessDate?: string }) {
  const id = randomUUID();
  const timestamp = now();
  const runType = input.runType || "MANUAL";
  const businessDate = runType === "NIGHTLY" ? input.businessDate || chinaBusinessDate() : null;
  const campaign = input.campaignId ? getCampaign(input.campaignId) : null;
  if (input.campaignId && !campaign) throw new Error("人才画像不存在");
  const scope = { campaignId: input.campaignId || null, resumeIds: input.resumeIds?.slice(0, 500) || [], incremental: runType !== "REBUILD" };
  const profile = campaign ? { roleName: campaign.roleName, locations: campaign.locations, markets: campaign.markets, channels: campaign.channels, mustHaves: campaign.mustHaves, niceToHaves: campaign.niceToHaves, exclusions: campaign.exclusions } : {};
  try {
    db.prepare(`INSERT INTO ai_runs (id, campaign_id, run_type, business_date, status, stage, scope_json, profile_snapshot_json, input_watermark, output_watermark, summary, metrics_json, error_message, triggered_by, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, 'QUEUED', 'QUEUED', ?, ?, NULL, NULL, '等待处理', '{}', '', ?, ?, NULL, NULL)`)
      .run(id, input.campaignId || null, runType, businessDate, JSON.stringify(scope), JSON.stringify(profile), input.triggeredBy || "当前用户", timestamp);
  } catch (error) {
    if (runType === "NIGHTLY" && error instanceof Error && error.message.includes("UNIQUE")) {
      return listAiRuns().find((run) => run.runType === "NIGHTLY" && run.businessDate === businessDate)!;
    }
    throw error;
  }
  return getAiRun(id)!;
}

export function getAiRun(id: string) {
  const row = db.prepare("SELECT r.*, c.name AS campaign_name FROM ai_runs r LEFT JOIN campaigns c ON c.id = r.campaign_id WHERE r.id = ?").get(id) as Row | undefined;
  return row ? aiRunFrom(row) : null;
}

export function listAiRuns(limit = 50) {
  return (db.prepare("SELECT r.*, c.name AS campaign_name FROM ai_runs r LEFT JOIN campaigns c ON c.id = r.campaign_id ORDER BY r.created_at DESC LIMIT ?").all(limit) as Row[]).map(aiRunFrom);
}

const organizationBusinessFactFields = new Set(["business_tags", "markets", "channels", "monetization", "business_history", "current_business", "business_status", "business_status_summary", "business_signals"]);

function promoteOrganizationFacts(organizationId: string, policy: ResumeQualityPolicy) {
  const rows = db.prepare(`SELECT id, field_name, value_json, confidence, classification, source_resume_id, source_quality_score
    FROM organization_facts WHERE organization_id = ?`).all(organizationId) as Row[];
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.field_name}\u0000${row.value_json}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  const update = db.prepare("UPDATE organization_facts SET status = ? WHERE id = ?");
  for (const facts of grouped.values()) {
    const field = String(facts[0].field_name);
    const classification = String(facts[0].classification || "FACT");
    const sourceCount = new Set(facts.map((row) => String(row.source_resume_id || row.id))).size;
    const maximumQuality = Math.max(...facts.map((row) => Number(row.source_quality_score || 0)));
    const maximumConfidence = Math.max(...facts.map((row) => Number(row.confidence || 0)));
    const needsCorroboration = organizationBusinessFactFields.has(field);
    const corroborated = sourceCount >= policy.businessFactMinimumSources;
    const explicitHighQualitySingle = classification === "FACT" && maximumQuality >= policy.highConfidenceMinimumScore && maximumConfidence >= 0.6;
    const inferencePromoted = classification === "INFERENCE" && corroborated && maximumConfidence >= 0.65;
    const promoted = needsCorroboration
      ? classification === "INFERENCE" ? inferencePromoted : corroborated || explicitHighQualitySingle
      : maximumQuality >= policy.graphMinimumScore;
    for (const fact of facts) update.run(promoted ? "PROMOTED_FACT" : "CANDIDATE_EVIDENCE", fact.id);
  }
}

function findOrCreateOrganization(employment: ResumeAnalysis["employments"][number], resumeId: string, quality: ResumeQualityAssessment, policy: ResumeQualityPolicy) {
  const normalizedName = normalize(employment.company);
  let organization = db.prepare("SELECT id FROM organizations WHERE normalized_name = ?").get(normalizedName) as { id: string } | undefined;
  const timestamp = now();
  const sourceConfidence = bounded(employment.confidence * (quality.score / 100), 0, 1);
  if (!organization) {
    organization = { id: randomUUID() };
    db.prepare("INSERT INTO organizations (id, name, normalized_name, domain, location, size, description, identity_confidence, created_at) VALUES (?, ?, ?, '', ?, '待确认', ?, ?, ?)")
      .run(organization.id, employment.company, normalizedName, employment.location || "待确认", employment.summary || "由已授权简历中的任职经历发现。", sourceConfidence, timestamp);
  }
  const facts: Array<[string, string, "FACT" | "INFERENCE", number]> = [
    ...employment.aliases.map((value) => ["aliases", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...(employment.industry ? [["industry", employment.industry, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]] : []),
    ...employment.businessTags.map((value) => ["business_tags", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...employment.markets.map((value) => ["markets", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...employment.channels.map((value) => ["channels", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...employment.monetization.map((value) => ["monetization", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...employment.businessHistory.map((value) => ["business_history", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...employment.currentBusiness.map((value) => ["current_business", value, "FACT" as const, sourceConfidence] as [string, string, "FACT", number]),
    ...(employment.businessStatus === "UNKNOWN" ? [] : [
      ["business_status", employment.businessStatus, "INFERENCE" as const, employment.businessStatusConfidence],
      ["business_status_summary", employment.businessStatusSummary, "INFERENCE" as const, employment.businessStatusConfidence],
      ...employment.businessSignals.map((value) => ["business_signals", value, "INFERENCE" as const, employment.businessStatusConfidence] as [string, string, "INFERENCE", number]),
    ] as Array<[string, string, "INFERENCE", number]>),
  ];
  const upsertFact = db.prepare(`INSERT INTO organization_facts
    (id, organization_id, field_name, value_json, confidence, source_resume_id, status, classification, evidence_quote, source_quality_score, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 'CANDIDATE_EVIDENCE', ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, field_name, value_json, source_resume_id) DO UPDATE SET confidence = excluded.confidence,
      classification = excluded.classification, evidence_quote = excluded.evidence_quote, source_quality_score = excluded.source_quality_score, last_seen_at = excluded.last_seen_at`);
  for (const [fieldName, value, classification, confidence] of facts) {
    if (!value) continue;
    upsertFact.run(randomUUID(), organization.id, fieldName, JSON.stringify(value), confidence, resumeId, classification, employment.evidenceQuote, quality.score, timestamp, timestamp);
  }
  promoteOrganizationFacts(organization.id, policy);
  return organization.id;
}

function factString(value: string | number | null) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return typeof parsed === "string" ? parsed.trim() : "";
  } catch {
    return "";
  }
}

function rebuildCampaignOrganization(campaignId: string, organizationId: string, fallbackEmployment: ResumeAnalysis["employments"][number]) {
  const campaign = getCampaign(campaignId)!;
  const promotedFacts = db.prepare(`SELECT f.field_name, f.value_json, f.confidence
    FROM organization_facts f JOIN resume_documents r ON r.id = f.source_resume_id
    WHERE f.organization_id = ? AND r.campaign_id = ? AND r.graph_eligible = 1 AND f.status = 'PROMOTED_FACT'
    ORDER BY f.confidence DESC, f.last_seen_at DESC`).all(organizationId, campaignId) as Row[];
  const values = (field: string, limit = 40) => [...new Set(promotedFacts.filter((row) => row.field_name === field).map((row) => factString(row.value_json)).filter(Boolean))].slice(0, limit);
  const products = values("business_tags");
  const markets = values("markets");
  const channels = values("channels");
  const monetization = values("monetization");
  const businessHistory = values("business_history", 20);
  const currentBusiness = values("current_business", 20);
  const businessSignals = values("business_signals", 12);
  const category = values("industry", 1)[0] || fallbackEmployment.industry || "AI 简历学习";
  const statusFact = promotedFacts.find((row) => row.field_name === "business_status");
  const summaryFact = promotedFacts.find((row) => row.field_name === "business_status_summary");
  const businessStatus = (statusFact ? factString(statusFact.value_json) : "UNKNOWN") as OrganizationBusinessStatus;
  const businessStatusSummary = summaryFact
    ? factString(summaryFact.value_json)
    : "现有高质量简历尚未形成足够的交叉证据，暂不判断增长或收缩。";
  const businessStatusConfidence = statusFact ? Math.round(Number(statusFact.confidence) * 100) : 0;
  const sources = db.prepare(`SELECT COUNT(DISTINCT r.id) AS source_count, AVG(r.quality_score) AS average_quality, AVG(e.confidence) AS average_confidence,
      GROUP_CONCAT(DISTINCT e.raw_title) AS roles, GROUP_CONCAT(e.summary, ' ') AS summaries
    FROM employments e JOIN resume_documents r ON r.id = e.resume_id
    WHERE e.organization_id = ? AND r.campaign_id = ? AND r.graph_eligible = 1`).get(organizationId, campaignId) as Row;
  const evidenceSourceCount = Number(sources.source_count || 0);
  const sourceQualityScore = Math.round(Number(sources.average_quality || 0));
  const averageConfidence = Number(sources.average_confidence || 0);
  const text = [sources.roles, sources.summaries, ...products, ...markets, ...channels, ...currentBusiness].join(" ").toLowerCase();
  const signals = [...campaign.channels, ...campaign.markets];
  const hits = signals.filter((signal) => text.includes(signal.toLowerCase())).length;
  const fitScore = bounded(Math.round(35 + (signals.length ? hits / signals.length : 0) * 35 + averageConfidence * 15 + sourceQualityScore * 0.15), 35, 95);
  const confidence = bounded(Math.round(sourceQualityScore * 0.45 + averageConfidence * 100 * 0.35 + Math.min(100, evidenceSourceCount * 40) * 0.2), 0, 100);
  const candidateEvidenceCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM organization_facts f JOIN resume_documents r ON r.id = f.source_resume_id
    WHERE f.organization_id = ? AND r.campaign_id = ? AND f.status = 'CANDIDATE_EVIDENCE'`).get(organizationId, campaignId) as { count: number }).count);
  const unknowns = [!currentBusiness.length ? "当前业务尚无已晋升的高质量证据" : "", businessStatus === "UNKNOWN" ? "业务状况尚未达到多来源交叉验证要求" : "", candidateEvidenceCount ? `${candidateEvidenceCount} 条信息仍在候选证据区` : ""].filter(Boolean);
  const organizationName = (db.prepare("SELECT name FROM organizations WHERE id = ?").get(organizationId) as { name: string }).name;
  const recommendationReason = `${organizationName}由 ${evidenceSourceCount} 份准入简历提供任职证据，公司可信度 ${confidence} 分；候选证据未达到晋升条件时不会写入正式业务画像。`;
  const timestamp = now();
  db.prepare(`INSERT INTO campaign_organizations
    (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json,
     business_history_json, current_business_json, business_status, business_status_summary, business_signals_json, business_status_confidence,
     fit_score, evidence_coverage, confidence, evidence_source_count, source_quality_score, recommendation_reason, unknowns_json, owner_name, updated_at)
    VALUES (?, ?, ?, ?, 'AI_LEARNED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AI 自主学习', ?)
    ON CONFLICT(campaign_id, organization_id) DO UPDATE SET
      category = excluded.category,
      status = CASE WHEN campaign_organizations.status IN ('WATCHLIST', 'REJECTED') THEN campaign_organizations.status ELSE 'AI_LEARNED' END,
      products_json = excluded.products_json, markets_json = excluded.markets_json, channels_json = excluded.channels_json, monetization_json = excluded.monetization_json,
      business_history_json = excluded.business_history_json, current_business_json = excluded.current_business_json,
      business_status = excluded.business_status, business_status_summary = excluded.business_status_summary,
      business_signals_json = excluded.business_signals_json, business_status_confidence = excluded.business_status_confidence,
      fit_score = excluded.fit_score, evidence_coverage = excluded.evidence_coverage, confidence = excluded.confidence,
      evidence_source_count = excluded.evidence_source_count, source_quality_score = excluded.source_quality_score,
      recommendation_reason = excluded.recommendation_reason, unknowns_json = excluded.unknowns_json,
      owner_name = CASE WHEN campaign_organizations.owner_name = '待分配' THEN 'AI 自主学习' ELSE campaign_organizations.owner_name END,
      updated_at = excluded.updated_at`)
    .run(randomUUID(), campaignId, organizationId, category, JSON.stringify(products), JSON.stringify(markets), JSON.stringify(channels), JSON.stringify(monetization),
      JSON.stringify(businessHistory), JSON.stringify(currentBusiness), businessStatus, businessStatusSummary, JSON.stringify(businessSignals), businessStatusConfidence,
      fitScore, confidence, confidence, evidenceSourceCount, sourceQualityScore, recommendationReason, JSON.stringify(unknowns), timestamp);
}

function getStoredIdentityResolution(resumeId: string): ResumeIdentityResolution | null {
  const row = db.prepare(`SELECT rim.decision, rim.matched_person_id, rim.score, rim.confidence, rim.reasons_json, rim.candidate_count, matched.name AS matched_person_name
    FROM resume_identity_matches rim
    LEFT JOIN people matched ON matched.id = rim.matched_person_id
    WHERE rim.resume_id = ?`).get(resumeId) as Row | undefined;
  if (!row) return null;
  return {
    decision: String(row.decision) as ResumeIdentityResolution["decision"],
    personId: row.matched_person_id ? String(row.matched_person_id) : null,
    personName: row.matched_person_name ? String(row.matched_person_name) : null,
    score: Number(row.score),
    confidence: Number(row.confidence),
    reasons: json(String(row.reasons_json)),
    candidateCount: Number(row.candidate_count),
  };
}

function persistResumeAnalysis(resumeId: string, campaignId: string, analysis: ResumeAnalysis, quality: ResumeQualityAssessment, policy: ResumeQualityPolicy) {
  const timestamp = now();
  const existingResume = db.prepare(`SELECT person_id, file_name, source_type, source_search_task_id, source_strategy_version_id, experiment_assignment_id
    FROM resume_documents WHERE id = ?`).get(resumeId) as {
      person_id: string | null; file_name: string; source_type: string; source_search_task_id: string | null;
      source_strategy_version_id: string | null; experiment_assignment_id: string | null;
    };
  db.prepare(`UPDATE resume_documents SET quality_score = ?, quality_grade = ?, quality_reasons_json = ?, quality_metrics_json = ?,
    graph_eligible = 1, search_eligible = ?, quality_assessed_at = ? WHERE id = ?`)
    .run(quality.score, quality.grade, JSON.stringify(quality.reasons), JSON.stringify(quality.metrics), quality.searchEligible ? 1 : 0, timestamp, resumeId);
  const identity = existingResume.person_id
    ? getStoredIdentityResolution(resumeId) || {
      decision: "EXISTING_LINK" as const,
      personId: existingResume.person_id,
      personName: (db.prepare("SELECT name FROM people WHERE id = ?").get(existingResume.person_id) as { name: string } | undefined)?.name || null,
      score: 100,
      confidence: 1,
      reasons: ["该简历已关联候选人档案，重新学习时保留现有关联"],
      candidateCount: 1,
    }
    : resolveResumeIdentity(resumeId, analysis);
  const reusablePersonId = identity.decision === "AUTO_MERGED" ? identity.personId : existingResume.person_id;
  let personId: string;
  if (!reusablePersonId) {
    personId = randomUUID();
    db.prepare("INSERT INTO people (id, name, normalized_name, headline, location, identity_confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(personId, analysis.person.name, normalize(analysis.person.name), analysis.person.headline, analysis.person.location, identity.confidence, timestamp);
  } else {
    personId = reusablePersonId;
    const existingPerson = db.prepare("SELECT name, headline, location FROM people WHERE id = ?").get(personId) as { name: string; headline: string; location: string } | undefined;
    if (!existingPerson) throw new Error("候选人档案不存在，无法合并简历");
    const personName = preferredCandidateName(existingPerson.name, analysis.person.name);
    db.prepare("UPDATE people SET name = ?, normalized_name = ?, headline = ?, location = ?, identity_confidence = MAX(identity_confidence, ?) WHERE id = ?")
      .run(personName, normalize(personName), analysis.person.headline.trim() || existingPerson.headline, analysis.person.location.trim() || existingPerson.location, identity.confidence, personId);
  }
  db.prepare("DELETE FROM person_skills WHERE resume_id = ?").run(resumeId);
  db.prepare("DELETE FROM graph_edges WHERE source_resume_id = ?").run(resumeId);
  db.prepare("DELETE FROM employments WHERE resume_id = ?").run(resumeId);
  db.prepare("DELETE FROM organization_facts WHERE source_resume_id = ?").run(resumeId);
  db.prepare("DELETE FROM evidence WHERE source_url = ?").run(`resume:${resumeId}`);

  let currentOrganizationId = "";
  const companyNames: string[] = [];
  for (const [index, employment] of analysis.employments.entries()) {
    const organizationId = findOrCreateOrganization(employment, resumeId, quality, policy);
    if (employment.isCurrent || !currentOrganizationId) currentOrganizationId = organizationId;
    companyNames.push(employment.company);
    const evidenceConfidence = bounded(employment.confidence * (quality.score / 100), 0, 1);
    db.prepare(`INSERT INTO employments (id, person_id, organization_id, resume_id, sequence, raw_company_name, raw_title, normalized_role, start_date, end_date, is_current, summary, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), personId, organizationId, resumeId, index, employment.company, employment.title, employment.normalizedRole, employment.startDate, employment.endDate, employment.isCurrent ? 1 : 0, employment.summary, evidenceConfidence, timestamp);
    db.prepare(`INSERT INTO graph_edges (id, from_type, from_id, edge_type, to_type, to_id, weight, confidence, source_resume_id, first_seen_at, last_seen_at)
      VALUES (?, 'PERSON', ?, ?, 'ORGANIZATION', ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), personId, employment.isCurrent ? "CURRENTLY_WORKS_AT" : "WORKED_AT", organizationId, employment.isCurrent ? 1 : 0.7, evidenceConfidence, resumeId, timestamp, timestamp);
    rebuildCampaignOrganization(campaignId, organizationId, employment);
    if (quality.score >= policy.highConfidenceMinimumScore && normalize(employment.company) !== "待核实任职公司") {
      try {
        createResearchTask({ campaignId, organizationId, topic: "核实当前业务、公开项目、产品落地与组织变化", triggerType: "HIGH_QUALITY_RESUME", createdBy: "AI 简历学习" });
      } catch {
        // Research quotas must not block resume learning.
      }
    }
    db.prepare("INSERT INTO evidence (id, entity_type, entity_id, classification, claim_text, quote, source_title, source_url, source_provider, confidence, observed_at) VALUES (?, 'ORGANIZATION', ?, 'FACT', ?, ?, ?, ?, '授权简历', ?, ?)")
      .run(randomUUID(), organizationId, `${analysis.person.name}曾任职于${employment.company}`, employment.evidenceQuote, existingResume.file_name, `resume:${resumeId}`, evidenceConfidence, timestamp);
    const promotedBusinessStatus = db.prepare(`SELECT 1 FROM organization_facts WHERE organization_id = ? AND source_resume_id = ? AND field_name = 'business_status' AND status = 'PROMOTED_FACT'`).get(organizationId, resumeId);
    if (promotedBusinessStatus && employment.businessStatus !== "UNKNOWN" && employment.businessSignals.length) {
      db.prepare("INSERT INTO evidence (id, entity_type, entity_id, classification, claim_text, quote, source_title, source_url, source_provider, confidence, observed_at) VALUES (?, 'ORGANIZATION', ?, 'INFERENCE', ?, ?, ?, ?, '授权简历', ?, ?)")
        .run(randomUUID(), organizationId, employment.businessStatusSummary, employment.evidenceQuote, existingResume.file_name, `resume:${resumeId}`, employment.businessStatusConfidence, timestamp);
    }
  }

  for (const skill of analysis.skills) {
    const skillName = normalize(skill.name);
    let skillRow = db.prepare("SELECT id FROM skills WHERE normalized_name = ?").get(skillName) as { id: string } | undefined;
    if (!skillRow) {
      skillRow = { id: randomUUID() };
      db.prepare("INSERT INTO skills (id, name, normalized_name, category, created_at) VALUES (?, ?, ?, ?, ?)").run(skillRow.id, skill.name, skillName, skill.category, timestamp);
    }
    const skillConfidence = bounded(skill.confidence * (quality.score / 100), 0, 1);
    db.prepare("INSERT INTO person_skills (id, person_id, skill_id, resume_id, confidence, evidence_text, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), personId, skillRow.id, resumeId, skillConfidence, skill.evidence, timestamp);
    db.prepare(`INSERT INTO graph_edges (id, from_type, from_id, edge_type, to_type, to_id, weight, confidence, source_resume_id, first_seen_at, last_seen_at)
      VALUES (?, 'PERSON', ?, 'HAS_SKILL', 'SKILL', ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), personId, skillRow.id, skillConfidence, skillConfidence, resumeId, timestamp, timestamp);
  }

  if (!currentOrganizationId) {
    const unknown = db.prepare("SELECT id FROM organizations WHERE normalized_name = '待核实任职公司'").get() as { id: string } | undefined;
    currentOrganizationId = unknown?.id || randomUUID();
    if (!unknown) db.prepare("INSERT INTO organizations VALUES (?, '待核实任职公司', '待核实任职公司', '', '待确认', '待确认', '简历未能可靠解析任职公司。', 0.2, ?)").run(currentOrganizationId, timestamp);
  }
  const structuralCoverage = bounded(Math.round((analysis.employments.length ? 45 : 20) + Math.min(analysis.skills.length, 10) * 4), 20, 90);
  const evidenceCoverage = bounded(Math.round(structuralCoverage * 0.45 + quality.score * 0.55), 20, 95);
  const fitScore = Math.round(analysis.match.score);
  db.prepare(`INSERT INTO campaign_people (id, campaign_id, person_id, organization_id, slot, status, fit_score, evidence_coverage, identity_confidence, recommendation_reason, strengths_json, unknowns_json, risk_flags_json, owner_name, review_reason, last_interaction_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, '[]', '待分配', ?, NULL, ?)
    ON CONFLICT(campaign_id, person_id) DO UPDATE SET organization_id = excluded.organization_id, slot = excluded.slot, fit_score = excluded.fit_score, evidence_coverage = excluded.evidence_coverage, identity_confidence = MAX(campaign_people.identity_confidence, excluded.identity_confidence), recommendation_reason = excluded.recommendation_reason, strengths_json = excluded.strengths_json, unknowns_json = excluded.unknowns_json, review_reason = CASE WHEN excluded.review_reason <> '' THEN excluded.review_reason ELSE campaign_people.review_reason END, updated_at = excluded.updated_at
    WHERE campaign_people.status IN ('PENDING_REVIEW','NEEDS_RESEARCH')`)
    .run(randomUUID(), campaignId, personId, currentOrganizationId, analysis.person.headline || getCampaign(campaignId)!.roleName, fitScore, evidenceCoverage, Math.round(identity.confidence * 100), analysis.match.rationale, JSON.stringify(analysis.match.strengths), JSON.stringify(analysis.match.gaps), identity.decision === "REVIEW_REQUIRED" ? identity.reasons[0] : "", timestamp);
  const campaignPerson = db.prepare("SELECT id, status, fit_score FROM campaign_people WHERE campaign_id = ? AND person_id = ?").get(campaignId, personId) as { id: string; status: PersonStatus; fit_score: number };
  const automationRule = matchCandidateAutoProgressRule(Number(campaignPerson.fit_score));
  let autoProgressed = false;
  const canAutoProgress = Boolean(automationRule && canTransitionPersonStatus(campaignPerson.status, automationRule.targetStatus));
  if (quality.searchEligible && automationRule && canAutoProgress && campaignPerson.status !== automationRule.targetStatus) {
    const note = `匹配分 ${Math.round(Number(campaignPerson.fit_score))}，简历质量 ${quality.score} 分，命中自动推进区间 ${automationRule.minimum}-${automationRule.maximum}，转为${PERSON_STATUS_LABELS[automationRule.targetStatus]}`;
    const progressed = db.prepare("UPDATE campaign_people SET status = ?, review_reason = ?, updated_at = ? WHERE id = ? AND status = ?")
      .run(automationRule.targetStatus, note, timestamp, campaignPerson.id, campaignPerson.status);
    if (progressed.changes) {
      db.prepare(`INSERT INTO feedback (id, campaign_id, entity_type, entity_id, action, reason_code, note, operator_name, created_at)
        VALUES (?, ?, 'PERSON', ?, ?, 'AUTO_SCORE_THRESHOLD', ?, '系统自动推进', ?)`)
        .run(randomUUID(), campaignId, personId, automationRule.targetStatus, note, timestamp);
      autoProgressed = true;
    }
  }
  db.prepare("INSERT INTO evidence (id, entity_type, entity_id, classification, claim_text, quote, source_title, source_url, source_provider, confidence, observed_at) VALUES (?, 'PERSON', ?, 'FACT', ?, ?, ?, ?, '授权简历', ?, ?)")
    .run(randomUUID(), personId, `解析到 ${companyNames.length} 段任职经历和 ${analysis.skills.length} 项有原文支持的技能`, analysis.employments[0]?.evidenceQuote || analysis.person.headline, existingResume.file_name, `resume:${resumeId}`, quality.score / 100, timestamp);
  db.prepare(`UPDATE resume_documents SET person_id = ?, status = 'READY', quality_score = ?, quality_grade = ?, quality_reasons_json = ?, quality_metrics_json = ?,
    graph_eligible = 1, search_eligible = ?, quality_assessed_at = ?, parse_version = ?, error_message = '', analyzed_at = ?, updated_at = ? WHERE id = ?`)
    .run(personId, quality.score, quality.grade, JSON.stringify(quality.reasons), JSON.stringify(quality.metrics), quality.searchEligible ? 1 : 0, timestamp, PARSE_VERSION, timestamp, timestamp, resumeId);
  db.prepare(`INSERT INTO resume_identity_matches
    (resume_id, person_id, matched_person_id, decision, score, confidence, reasons_json, candidate_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(resume_id) DO UPDATE SET person_id = excluded.person_id, matched_person_id = excluded.matched_person_id, decision = excluded.decision, score = excluded.score, confidence = excluded.confidence, reasons_json = excluded.reasons_json, candidate_count = excluded.candidate_count, updated_at = excluded.updated_at`)
    .run(resumeId, personId, identity.personId, identity.decision, identity.score, identity.confidence, JSON.stringify(identity.reasons), identity.candidateCount, timestamp, timestamp);
  let originKeywords: string[] = [];
  if (existingResume.source_search_task_id) {
    const task = db.prepare("SELECT query_json FROM search_tasks WHERE id = ?").get(existingResume.source_search_task_id) as { query_json: string } | undefined;
    if (task) originKeywords = compactBossSearchKeywords(json<{ keywords?: string[] }>(task.query_json).keywords || []);
  }
  attachCandidateOrigin({
    campaignId,
    personId,
    resumeId,
    searchTaskId: existingResume.source_search_task_id,
    organizationId: currentOrganizationId,
    strategyVersionId: existingResume.source_strategy_version_id,
    experimentAssignmentId: existingResume.experiment_assignment_id,
    keywords: originKeywords,
    sourceType: existingResume.source_type,
  });
  recordActivityEvent({
    campaignId,
    personId,
    organizationId: currentOrganizationId,
    resumeId,
    searchTaskId: existingResume.source_search_task_id,
    strategyVersionId: existingResume.source_strategy_version_id,
    experimentAssignmentId: existingResume.experiment_assignment_id,
    eventType: reusablePersonId ? "RESUME_IMPORTED" : "CANDIDATE_CREATED",
    reasonCode: reusablePersonId ? "RESUME_LINKED_TO_CANDIDATE" : "HIGH_QUALITY_RESUME_ADMITTED",
    actorType: "AI",
    actorId: PARSE_VERSION,
    payload: { fitScore, qualityScore: quality.score, identityDecision: identity.decision },
    occurredAt: timestamp,
    idempotencyKey: `candidate-learned:${resumeId}:${personId}`,
  });
  if (autoProgressed && automationRule) recordActivityEvent({
    campaignId, personId, organizationId: currentOrganizationId, resumeId,
    searchTaskId: existingResume.source_search_task_id, strategyVersionId: existingResume.source_strategy_version_id,
    experimentAssignmentId: existingResume.experiment_assignment_id, eventType: "CANDIDATE_STAGE_CHANGED",
    fromStatus: campaignPerson.status, toStatus: automationRule.targetStatus, reasonCode: "AUTO_SCORE_THRESHOLD",
    actorType: "AI", actorId: "candidate-automation", payload: { fitScore, qualityScore: quality.score }, occurredAt: timestamp,
    idempotencyKey: `candidate-auto-stage:${resumeId}:${personId}:${automationRule.targetStatus}`,
  });
  return { personId, identity, autoProgressed };
}

function weightFor(campaignId: string, signalType: string, signalKey: string) {
  const row = db.prepare("SELECT weight FROM learning_weights WHERE campaign_id = ? AND signal_type = ? AND signal_key = ?").get(campaignId, signalType, signalKey) as { weight: number } | undefined;
  return row?.weight || 1;
}

function generateSearchTasks(campaignId: string, runId: string) {
  const campaign = getCampaign(campaignId)!;
  const automation = getCandidateAutomationSettings();
  const minimumScore = automation.searchTaskMinimumScore;
  const policy = automation.resumeQualityPolicy;
  const organizations = db.prepare(`SELECT co.organization_id, o.name, o.location, co.fit_score, co.confidence, co.evidence_source_count, co.source_quality_score, co.recommendation_reason,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT e.normalized_role) FROM employments e JOIN resume_documents r ON r.id = e.resume_id WHERE e.organization_id = o.id AND r.search_eligible = 1), '') AS roles
    FROM campaign_organizations co JOIN organizations o ON o.id = co.organization_id
    WHERE co.campaign_id = ? AND co.fit_score >= ? AND co.confidence >= ? AND co.evidence_source_count >= ? AND co.status <> 'REJECTED'
      AND o.normalized_name <> '待核实任职公司'
      AND EXISTS (SELECT 1 FROM employments e JOIN resume_documents r ON r.id = e.resume_id WHERE e.organization_id = o.id AND r.campaign_id = co.campaign_id AND r.search_eligible = 1)
    ORDER BY co.confidence DESC, co.fit_score DESC LIMIT 30`).all(campaignId, minimumScore, policy.organizationSearchMinimumConfidence, policy.organizationSearchMinimumSources) as Row[];
  const timestamp = now();
  const expires = new Date(Date.now() + searchTaskLifetimeDays * 86_400_000).toISOString();
  const period = chinaBusinessDate().slice(0, 7);
  const strategy = ensureActiveStrategyVersion(campaignId);
  let created = 0;
  for (const organization of organizations) {
    const roles = String(organization.roles || "").split(",").filter(Boolean);
    const roleKeywords = compactBossSearchKeywords([campaign.roleName, ...roles])
      .sort((left, right) => weightFor(campaignId, "KEYWORD", right) - weightFor(campaignId, "KEYWORD", left))
      .slice(0, 3);
    const companyWeight = weightFor(campaignId, "COMPANY", String(organization.name));
    const eligibilityScore = Number(organization.fit_score) * 0.55 + Number(organization.confidence) * 0.3 + Number(organization.source_quality_score) * 0.15;
    const priority = bounded(Math.round(eligibilityScore * companyWeight), 1, 100);
    const queryJson = JSON.stringify({ keywords: roleKeywords, locations: campaign.locations, experience: "结果充足后再优先筛选 5 年以上或负责人经历", instructions: bossSearchInstructions });
    const reasonJson = JSON.stringify({ summary: String(organization.recommendation_reason), evidence: [`公司匹配分 ${organization.fit_score}，综合可信度 ${organization.confidence}，独立简历来源 ${organization.evidence_source_count} 份，来源质量均分 ${organization.source_quality_score}`], expectedCandidate: campaign.mustHaves.slice(0, 3).join("；") });
    const existingOpenTask = db.prepare("SELECT id FROM search_tasks WHERE campaign_id = ? AND company_name = ? AND status IN ('NEW','CLAIMED','IN_PROGRESS','DEFERRED') ORDER BY created_at DESC LIMIT 1")
      .get(campaignId, organization.name) as { id: string } | undefined;
    if (existingOpenTask) {
      db.prepare("UPDATE search_tasks SET run_id = ?, query_json = ?, reason_json = ?, priority = ?, expires_at = ?, strategy_version_id = ? WHERE id = ?")
        .run(runId, queryJson, reasonJson, priority, expires, strategy.id, existingOpenTask.id);
      continue;
    }
    const dedupeKey = createHash("sha256").update(`${campaignId}|${organization.organization_id}|${period}|broad-v1`).digest("hex");
    const taskId = randomUUID();
    const result = db.prepare(`INSERT OR IGNORE INTO search_tasks (id, campaign_id, run_id, task_type, title, company_name, query_json, reason_json, priority, dedupe_key, status, claimed_by, expires_at, created_at, completed_at, strategy_version_id, experiment_assignment_id)
      VALUES (?, ?, ?, 'BOSS_MANUAL_SEARCH', ?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?, NULL, ?, NULL)`)
      .run(taskId, campaignId, runId, `在 BOSS 搜索 ${organization.name} 的目标负责人`, organization.name,
        queryJson, reasonJson,
        priority, dedupeKey, expires, timestamp, strategy.id);
    created += Number(result.changes);
    if (result.changes) {
      const assignment = assignExperimentToSearchTask(campaignId, taskId);
      let assignedKeywords = roleKeywords;
      if (assignment?.experiment.dimension === "KEYWORD") {
        assignedKeywords = compactBossSearchKeywords([assignment.arm.value, ...roleKeywords]).slice(0, 4);
        db.prepare("UPDATE search_tasks SET query_json = ? WHERE id = ?").run(JSON.stringify({ keywords: assignedKeywords, locations: campaign.locations, experience: "结果充足后再优先筛选 5 年以上或负责人经历", instructions: bossSearchInstructions }), taskId);
      }
      recordActivityEvent({ campaignId, organizationId: String(organization.organization_id), searchTaskId: taskId, strategyVersionId: strategy.id,
        experimentAssignmentId: assignment?.id || null, eventType: "SEARCH_TASK_CREATED", reasonCode: assignment ? "EXPERIMENT_EXPLORATION" : "HIGH_CONFIDENCE_GRAPH",
        actorType: "AI", actorId: "search-strategy", payload: { companyName: organization.name, keywords: assignedKeywords, priority, experimentArm: assignment?.arm.key || null }, occurredAt: timestamp, idempotencyKey: `search-task-created:${taskId}` });
    }
  }
  return created;
}

export async function executeAiRun(id: string) {
  const run = getAiRun(id);
  if (!run) throw new Error("学习任务不存在");
  if (!["QUEUED", "FAILED", "PARTIAL_SUCCESS"].includes(run.status)) return run;
  const scope = run.scope as { campaignId?: string | null; resumeIds?: string[]; incremental?: boolean };
  const resumeIds = scope.incremental === false && scope.campaignId && !scope.resumeIds?.length
    ? (db.prepare("SELECT id FROM resume_documents WHERE campaign_id = ? ORDER BY created_at").all(scope.campaignId) as Array<{ id: string }>).map((row) => row.id)
    : getPendingResumeIds(scope.campaignId || undefined, scope.resumeIds?.length ? scope.resumeIds : undefined);
  const timestamp = now();
  const qualityPolicy = getCandidateAutomationSettings().resumeQualityPolicy;
  const runningMetrics = { inputResumes: resumeIds.length, processed: 0, analyzed: 0, failed: 0, skippedAdvanced: 0, qualityBlocked: 0, quarantined: 0, autoProgressed: 0, identityMerged: 0, identityReviewRequired: 0, searchTasks: 0 };
  const initialSummary = resumeIds.length ? `准备分析 ${resumeIds.length} 份简历。` : "没有待分析简历，准备根据现有图谱生成搜索任务。";
  const claimed = db.prepare("UPDATE ai_runs SET status = 'RUNNING', stage = 'ANALYZE_RESUMES', summary = ?, metrics_json = ?, started_at = ?, error_message = '' WHERE id = ? AND status IN ('QUEUED','FAILED','PARTIAL_SUCCESS')")
    .run(initialSummary, JSON.stringify(runningMetrics), timestamp, id);
  if (!claimed.changes) return getAiRun(id)!;
  let analyzed = 0;
  let failed = 0;
  let skippedAdvanced = 0;
  let qualityBlocked = 0;
  let quarantined = 0;
  let autoProgressed = 0;
  let identityMerged = 0;
  let identityReviewRequired = 0;
  let tasksCreated = 0;
  const affectedCampaigns = new Set<string>();
  const updateProgress = () => {
    const processed = analyzed + failed + skippedAdvanced + qualityBlocked;
    db.prepare("UPDATE ai_runs SET summary = ?, metrics_json = ? WHERE id = ?")
      .run(`正在处理简历：${processed} / ${resumeIds.length}，入图 ${analyzed} 份，质量拦截 ${qualityBlocked} 份，跳过已推进 ${skippedAdvanced} 份，失败 ${failed} 份。`, JSON.stringify({ ...runningMetrics, processed, analyzed, failed, skippedAdvanced, qualityBlocked, quarantined, autoProgressed, identityMerged, identityReviewRequired }), id);
  };
  for (const resumeId of resumeIds) {
    const resume = getResumeRunState(resumeId);
    if (!resume) continue;
    affectedCampaigns.add(resume.campaign_id);
    db.prepare("INSERT OR IGNORE INTO ai_run_items (id, run_id, entity_type, entity_id, status, attempts, result_json, error_message) VALUES (?, ?, 'RESUME', ?, 'QUEUED', 0, '{}', '')").run(randomUUID(), id, resumeId);
    if (isAdvancedResumeCandidate(resume)) {
      markAdvancedResumeSkipped(id, resumeId, resume);
      skippedAdvanced += 1;
      updateProgress();
      continue;
    }
    const text = getResumeText(resumeId);
    const preflight = assessResumeTextPreflight(text);
    const humanRestored = isResumeQualityRestored(resumeId);
    if (preflight.score < qualityPolicy.quarantineBelow && !humanRestored && !(resume.resume_status === "READY" && resume.person_id)) {
      const assessedAt = now();
      const reasons = preflight.reasons.length ? preflight.reasons : ["简历基础结构未达到 AI 学习准入要求"];
      db.prepare(`UPDATE resume_documents SET status = 'QUARANTINED', quality_score = ?, quality_grade = 'QUARANTINED', quality_reasons_json = ?, quality_metrics_json = ?,
        graph_eligible = 0, search_eligible = 0, quality_assessed_at = ?, error_message = '', analyzed_at = ?, updated_at = ? WHERE id = ?`)
        .run(preflight.score, JSON.stringify(reasons), JSON.stringify({ ...preflight.metrics, preflightScore: preflight.score }), assessedAt, assessedAt, assessedAt, resumeId);
      db.prepare("UPDATE ai_run_items SET status = 'SKIPPED', result_json = ?, error_message = '', completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?")
        .run(JSON.stringify({ reason: "RESUME_QUARANTINED", qualityScore: preflight.score, qualityReasons: reasons }), assessedAt, id, resumeId);
      qualityBlocked += 1;
      quarantined += 1;
      updateProgress();
      continue;
    }
    db.prepare("UPDATE ai_run_items SET status = 'RUNNING', attempts = attempts + 1, started_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?").run(now(), id, resumeId);
    db.prepare("UPDATE resume_documents SET status = 'PROCESSING', error_message = '' WHERE id = ?").run(resumeId);
    try {
      const campaign = getCampaign(resume.campaign_id)!;
      const rawAnalysis = await analyzeResumeWithAi(campaign, text) || fallbackResumeAnalysis(text, resume.campaign_id);
      const evaluated = evaluateResumeQuality(text, rawAnalysis, qualityPolicy);
      const analysis = evaluated.analysis;
      if (!evaluated.assessment.graphEligible) {
        const assessedAt = now();
        const resumeStatus = humanRestored ? "NEEDS_REVIEW" : evaluated.assessment.grade === "QUARANTINED" ? "QUARANTINED" : "NEEDS_REVIEW";
        db.prepare(`UPDATE resume_documents SET status = ?, quality_score = ?, quality_grade = ?, quality_reasons_json = ?, quality_metrics_json = ?,
          graph_eligible = 0, search_eligible = 0, quality_assessed_at = ?, parse_version = ?, error_message = '', analyzed_at = ?, updated_at = ? WHERE id = ?`)
          .run(resumeStatus, evaluated.assessment.score, evaluated.assessment.grade, JSON.stringify(evaluated.assessment.reasons), JSON.stringify(evaluated.assessment.metrics), assessedAt, PARSE_VERSION, assessedAt, assessedAt, resumeId);
        db.prepare("UPDATE ai_run_items SET status = 'SKIPPED', result_json = ?, error_message = '', completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?")
          .run(JSON.stringify({ reason: "QUALITY_GATE_BLOCKED", qualityScore: evaluated.assessment.score, qualityGrade: evaluated.assessment.grade, qualityReasons: evaluated.assessment.reasons }), assessedAt, id, resumeId);
        qualityBlocked += 1;
        if (resumeStatus === "QUARANTINED") quarantined += 1;
        updateProgress();
        continue;
      }
      const latestResume = getResumeRunState(resumeId);
      if (latestResume && isAdvancedResumeCandidate(latestResume)) {
        markAdvancedResumeSkipped(id, resumeId, latestResume, resume.resume_status);
        skippedAdvanced += 1;
        updateProgress();
        continue;
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const persisted = persistResumeAnalysis(resumeId, resume.campaign_id, analysis, evaluated.assessment, qualityPolicy);
        if (persisted.autoProgressed) autoProgressed += 1;
        if (persisted.identity.decision === "AUTO_MERGED") identityMerged += 1;
        if (persisted.identity.decision === "REVIEW_REQUIRED") identityReviewRequired += 1;
        db.prepare("UPDATE ai_run_items SET status = 'SUCCEEDED', result_json = ?, completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?")
          .run(JSON.stringify({ person: analysis.person.name, personId: persisted.personId, employments: analysis.employments.length, skills: analysis.skills.length, score: analysis.match.score, qualityScore: evaluated.assessment.score, qualityGrade: evaluated.assessment.grade, identity: persisted.identity }), now(), id, resumeId);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      analyzed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "简历分析失败";
      if (resume.resume_status === "READY" && resume.person_id) {
        db.prepare("UPDATE resume_documents SET status = 'READY', error_message = '' WHERE id = ?").run(resumeId);
      } else {
        db.prepare("UPDATE resume_documents SET status = 'FAILED', error_message = ?, updated_at = ? WHERE id = ?").run(message, now(), resumeId);
      }
      db.prepare("UPDATE ai_run_items SET status = 'FAILED', error_message = ?, completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?").run(message, now(), id, resumeId);
      failed += 1;
    }
    updateProgress();
  }
  if (scope.campaignId) affectedCampaigns.add(scope.campaignId);
  else for (const campaign of listCampaigns().filter((item) => item.status === "ACTIVE")) affectedCampaigns.add(campaign.id);
  db.prepare("UPDATE ai_runs SET stage = 'GENERATE_SEARCH_TASKS', summary = ?, metrics_json = ? WHERE id = ?")
    .run("简历质量闸门处理已完成，正在根据高可信图谱生成 BOSS 搜索任务。", JSON.stringify({ ...runningMetrics, processed: analyzed + failed + skippedAdvanced + qualityBlocked, analyzed, failed, skippedAdvanced, qualityBlocked, quarantined, autoProgressed, identityMerged, identityReviewRequired }), id);
  for (const campaignId of affectedCampaigns) tasksCreated += generateSearchTasks(campaignId, id);
  const status = failed && analyzed ? "PARTIAL_SUCCESS" : failed ? "FAILED" : "SUCCEEDED";
  const identitySummary = identityMerged || identityReviewRequired ? ` 自动合并 ${identityMerged} 份至现有人选，${identityReviewRequired} 份近似档案待复核。` : "";
  const skippedSummary = skippedAdvanced ? `跳过已推进候选人 ${skippedAdvanced} 份。` : "";
  const automationSummary = autoProgressed ? `按评分规则自动推进 ${autoProgressed} 人。` : "";
  const qualitySummary = qualityBlocked ? `质量闸门拦截 ${qualityBlocked} 份（隔离 ${quarantined} 份）。` : "";
  const summary = resumeIds.length ? `完成 ${analyzed} 份高质量简历入图，${qualitySummary}${skippedSummary}${automationSummary}失败 ${failed} 份。${identitySummary}生成 ${tasksCreated} 个 BOSS 人工搜索任务。` : `没有待分析简历，基于现有高可信图谱生成 ${tasksCreated} 个新搜索任务。`;
  db.prepare("UPDATE ai_runs SET status = ?, stage = 'COMPLETED', summary = ?, metrics_json = ?, output_watermark = ?, completed_at = ? WHERE id = ?")
    .run(status, summary, JSON.stringify({ inputResumes: resumeIds.length, processed: analyzed + failed + skippedAdvanced + qualityBlocked, analyzed, failed, skippedAdvanced, qualityBlocked, quarantined, autoProgressed, identityMerged, identityReviewRequired, searchTasks: tasksCreated }), now(), now(), id);
  return getAiRun(id)!;
}

export async function processNextAiRun() {
  const row = db.prepare("SELECT id FROM ai_runs WHERE status = 'QUEUED' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (!row) return null;
  return executeAiRun(row.id);
}

export function ensureNightlyRun() {
  const businessDate = chinaBusinessDate();
  const existing = db.prepare("SELECT id FROM ai_runs WHERE run_type = 'NIGHTLY' AND business_date = ?").get(businessDate) as { id: string } | undefined;
  if (existing) return getAiRun(existing.id)!;
  return createAiRun({ runType: "NIGHTLY", businessDate, triggeredBy: "系统定时任务" });
}

export function listSearchTasks(input: { campaignId?: string; status?: string | string[]; limit?: number } = {}) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.campaignId) { clauses.push("s.campaign_id = ?"); values.push(input.campaignId); }
  if (Array.isArray(input.status) && input.status.length) {
    clauses.push(`s.status IN (${input.status.map(() => "?").join(",")})`);
    values.push(...input.status);
  } else if (typeof input.status === "string") { clauses.push("s.status = ?"); values.push(input.status); }
  values.push(input.limit || 100);
  return (db.prepare(`SELECT s.*, c.name AS campaign_name FROM search_tasks s JOIN campaigns c ON c.id = s.campaign_id ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY s.priority DESC, s.created_at DESC LIMIT ?`).all(...values) as Row[]).map(searchTaskFrom);
}

export function getSearchTask(id: string) {
  const row = db.prepare("SELECT s.*, c.name AS campaign_name FROM search_tasks s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?").get(id) as Row | undefined;
  return row ? searchTaskFrom(row) : null;
}

export function hasSearchTaskFeedback(id: string) {
  return Boolean(db.prepare("SELECT 1 FROM search_task_feedback WHERE task_id = ?").get(id));
}

export function updateSearchTask(id: string, input: { status?: SearchTask["status"]; claimedBy?: string }) {
  const timestamp = now();
  db.prepare(`UPDATE search_tasks SET status = COALESCE(?, status), claimed_by = COALESCE(?, claimed_by), completed_at = CASE WHEN ? IN ('COMPLETED','NO_RESULT','LOW_QUALITY','CANCELLED') THEN ? ELSE completed_at END WHERE id = ?`)
    .run(input.status || null, input.claimedBy || null, input.status || null, timestamp, id);
  const row = db.prepare("SELECT s.*, c.name AS campaign_name FROM search_tasks s JOIN campaigns c ON c.id = s.campaign_id WHERE s.id = ?").get(id) as Row | undefined;
  return row ? searchTaskFrom(row) : null;
}

const pluginTransitions: Record<SearchTask["status"], SearchTask["status"][]> = {
  NEW: ["CLAIMED"],
  CLAIMED: ["IN_PROGRESS", "DEFERRED"],
  IN_PROGRESS: ["DEFERRED"],
  DEFERRED: ["CLAIMED", "IN_PROGRESS"],
  COMPLETED: [],
  NO_RESULT: [],
  LOW_QUALITY: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function transitionSearchTask(id: string, status: SearchTask["status"], actor: string) {
  const row = db.prepare("SELECT * FROM search_tasks WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("搜索任务不存在");
  const currentStatus = row.status as SearchTask["status"];
  if (currentStatus === status) return updateSearchTask(id, { claimedBy: actor });
  if (!pluginTransitions[currentStatus].includes(status)) throw new Error(`任务不能从 ${currentStatus} 变更为 ${status}`);
  const updated = updateSearchTask(id, { status, claimedBy: actor });
  recordActivityEvent({ campaignId: String(row.campaign_id), searchTaskId: id, strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    experimentAssignmentId: row.experiment_assignment_id ? String(row.experiment_assignment_id) : null,
    eventType: status === "CLAIMED" ? "SEARCH_TASK_CLAIMED" : "SEARCH_STARTED", fromStatus: currentStatus, toStatus: status,
    reasonCode: "PLUGIN_TASK_TRANSITION", actorType: "PLUGIN", actorId: actor, occurredAt: now(), idempotencyKey: `search-task-stage:${id}:${status}` });
  return updated;
}

export function submitSearchTaskFeedback(input: { taskId: string; resultCount: number; qualifiedCount: number; effectiveConversations: number; note?: string; createdBy?: string }) {
  const task = db.prepare("SELECT * FROM search_tasks WHERE id = ?").get(input.taskId) as Row | undefined;
  if (!task) throw new Error("搜索任务不存在");
  if (db.prepare("SELECT 1 FROM search_task_feedback WHERE task_id = ?").get(input.taskId)) throw new Error("该搜索任务已提交反馈");
  const resultCount = bounded(Math.round(input.resultCount || 0), 0, 10000);
  const qualifiedCount = bounded(Math.round(input.qualifiedCount || 0), 0, resultCount);
  const conversations = bounded(Math.round(input.effectiveConversations || 0), 0, qualifiedCount);
  const positive = resultCount ? bounded((qualifiedCount / resultCount) * 0.45 + (conversations / Math.max(qualifiedCount, 1)) * 0.55, 0, 1) : 0;
  const companyName = String(task.company_name);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO search_task_feedback (id, task_id, result_count, qualified_count, effective_conversations, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), input.taskId, resultCount, qualifiedCount, conversations, input.note || "", input.createdBy || "当前用户", timestamp);
    db.prepare("UPDATE search_tasks SET status = ?, completed_at = ? WHERE id = ?").run(resultCount === 0 ? "NO_RESULT" : qualifiedCount === 0 ? "LOW_QUALITY" : "COMPLETED", timestamp, input.taskId);
    const updateSignal = (signalType: "COMPANY" | "KEYWORD", signalKey: string) => {
      const current = db.prepare("SELECT * FROM learning_weights WHERE campaign_id = ? AND signal_type = ? AND signal_key = ?").get(task.campaign_id, signalType, signalKey) as Row | undefined;
      const sampleCount = Number(current?.sample_count || 0) + 1;
      const positiveCount = Number(current?.positive_count || 0) + positive;
      const oldWeight = Number(current?.weight || 1);
      const weight = oldWeight;
      db.prepare(`INSERT INTO learning_weights (id, campaign_id, signal_type, signal_key, sample_count, positive_count, weight, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, signal_type, signal_key) DO UPDATE SET sample_count = excluded.sample_count, positive_count = excluded.positive_count, weight = excluded.weight, updated_at = excluded.updated_at`)
        .run(randomUUID(), task.campaign_id, signalType, signalKey, sampleCount, positiveCount, weight, timestamp);
      return { sampleCount, weight };
    };
    const companyLearning = updateSignal("COMPANY", companyName);
    const taskQuery = json<{ keywords?: string[] }>(String(task.query_json));
    for (const keyword of compactBossSearchKeywords(taskQuery.keywords || [])) updateSignal("KEYWORD", keyword);
    const sampleCount = companyLearning.sampleCount;
    const newWeight = companyLearning.weight;
    const autonomy = getAutonomySettings();
    if (sampleCount >= autonomy.reviewMinimumTasks) {
      const confidence = bounded(sampleCount / 10, 0.3, 0.95);
      db.prepare(`INSERT INTO learning_recommendations (id, campaign_id, run_id, recommendation_type, title, reason, payload_json, confidence, status, created_at, reviewed_at)
        VALUES (?, ?, ?, 'COMPANY_SIGNAL', ?, ?, ?, ?, 'PENDING_REVIEW', ?, NULL)`)
        .run(randomUUID(), task.campaign_id, task.run_id, `${companyName} 搜索信号待周复盘`, `累计 ${sampleCount} 次任务；达到结果样本门槛后，由周复盘统一比较并小步调整。`, JSON.stringify({ companyName, currentWeight: Number(newWeight.toFixed(3)), sampleCount }), confidence, timestamp);
    }
    recordActivityEvent({ campaignId: String(task.campaign_id), searchTaskId: input.taskId,
      strategyVersionId: task.strategy_version_id ? String(task.strategy_version_id) : null, experimentAssignmentId: task.experiment_assignment_id ? String(task.experiment_assignment_id) : null,
      eventType: "SEARCH_FEEDBACK_RECORDED", reasonCode: "TASK_FEEDBACK", actorType: "USER", actorId: input.createdBy || "当前用户",
      payload: { resultCount, qualifiedCount, effectiveConversations: conversations }, occurredAt: timestamp, idempotencyKey: `search-feedback:${input.taskId}` });
    db.exec("COMMIT");
    return { task: updateSearchTask(input.taskId, {}), learning: { companyName, sampleCount, weight: Number(newWeight.toFixed(3)) } };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listLearningRecommendations(campaignId?: string) {
  const rows = campaignId
    ? db.prepare("SELECT * FROM learning_recommendations WHERE campaign_id = ? ORDER BY created_at DESC").all(campaignId)
    : db.prepare("SELECT * FROM learning_recommendations ORDER BY created_at DESC").all();
  return (rows as Row[]).map(recommendationFrom);
}

export function reviewLearningRecommendation(id: string, status: "APPROVED" | "REJECTED") {
  db.prepare("UPDATE learning_recommendations SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'PENDING_REVIEW'").run(status, now(), id);
  const row = db.prepare("SELECT * FROM learning_recommendations WHERE id = ?").get(id) as Row | undefined;
  return row ? recommendationFrom(row) : null;
}

export function getGraphData(campaignId?: string): GraphData {
  const campaignFilter = campaignId ? "AND cp.campaign_id = ?" : "";
  const args = campaignId ? [campaignId] : [];
  const people = db.prepare(`SELECT DISTINCT p.id, p.name, p.headline, cp.fit_score, cp.status
    FROM people p JOIN campaign_people cp ON cp.person_id = p.id
    WHERE EXISTS (SELECT 1 FROM resume_documents r WHERE r.person_id = p.id AND r.campaign_id = cp.campaign_id AND r.graph_eligible = 1) ${campaignFilter}`).all(...args) as Row[];
  const organizations = db.prepare(`SELECT DISTINCT o.id, o.name, o.location, co.fit_score, co.status
    FROM organizations o JOIN campaign_organizations co ON co.organization_id = o.id
    WHERE o.normalized_name <> '待核实任职公司'
      AND EXISTS (
        SELECT 1 FROM employments e JOIN resume_documents r ON r.id = e.resume_id
        WHERE e.organization_id = o.id AND r.campaign_id = co.campaign_id AND r.graph_eligible = 1
      ) ${campaignId ? "AND co.campaign_id = ?" : ""}`).all(...args) as Row[];
  const personIds = new Set(people.map((row) => String(row.id)));
  const organizationIds = new Set(organizations.map((row) => String(row.id)));
  const rawEdges = db.prepare(`SELECT ge.* FROM graph_edges ge JOIN resume_documents r ON r.id = ge.source_resume_id
    WHERE r.graph_eligible = 1 ORDER BY ge.confidence DESC LIMIT 3000`).all() as Row[];
  const edges = rawEdges.filter((row) => personIds.has(String(row.from_id)) && (String(row.to_type) === "SKILL" || organizationIds.has(String(row.to_id))));
  const skillIds = [...new Set(edges.filter((row) => String(row.to_type) === "SKILL").map((row) => String(row.to_id)))];
  const skills = skillIds.length ? db.prepare(`SELECT * FROM skills WHERE id IN (${skillIds.map(() => "?").join(",")})`).all(...skillIds) as Row[] : [];
  const talentCounts = db.prepare(`SELECT o.id, o.name, COUNT(DISTINCT e.person_id) AS talent_count, COUNT(DISTINCT CASE WHEN e.normalized_role LIKE '%负责人%' OR e.normalized_role LIKE '%总监%' OR e.normalized_role LIKE '%manager%' OR e.normalized_role LIKE '%lead%' THEN e.person_id END) AS target_count, MAX(co.fit_score) AS score
    FROM organizations o
    JOIN campaign_organizations co ON co.organization_id = o.id
    JOIN employments e ON e.organization_id = o.id
    JOIN resume_documents r ON r.id = e.resume_id AND r.campaign_id = co.campaign_id
    WHERE r.graph_eligible = 1 ${campaignId ? "AND co.campaign_id = ?" : ""} GROUP BY o.id, o.name ORDER BY score DESC, talent_count DESC LIMIT 50`).all(...args) as Row[];
  return {
    nodes: [
      ...people.map((row) => ({ id: String(row.id), type: "PERSON" as const, label: String(row.name), detail: String(row.headline), score: Number(row.fit_score), status: String(row.status) })),
      ...organizations.map((row) => ({ id: String(row.id), type: "ORGANIZATION" as const, label: String(row.name), detail: String(row.location), score: Number(row.fit_score), status: String(row.status) })),
      ...skills.map((row) => ({ id: String(row.id), type: "SKILL" as const, label: String(row.name), detail: String(row.category), score: 0, status: "EVIDENCE_BACKED" })),
    ],
    edges: edges.map((row) => ({ id: String(row.id), fromId: String(row.from_id), toId: String(row.to_id), type: String(row.edge_type), weight: Number(row.weight), confidence: Number(row.confidence), label: String(row.edge_type) === "HAS_SKILL" ? "掌握" : String(row.edge_type) === "CURRENTLY_WORKS_AT" ? "现任" : "曾任" })),
    metrics: { people: people.length, organizations: organizations.length, skills: skills.length, evidenceBackedEdges: edges.length },
    companyInsights: talentCounts.map((row) => ({ organizationId: String(row.id), name: String(row.name), talentCount: Number(row.talent_count), targetRoleCount: Number(row.target_count), score: Number(row.score), reasons: [`简历库已确认 ${row.talent_count} 条人才关系`, `其中 ${row.target_count} 条为负责人或管理岗位关系`] })),
  };
}

export function learningOverview() {
  const count = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count);
  return { resumes: count("SELECT COUNT(*) AS count FROM resume_documents"), pendingResumes: count("SELECT COUNT(*) AS count FROM resume_documents WHERE status IN ('PENDING','FAILED','NEEDS_REVIEW')"), quarantinedResumes: count("SELECT COUNT(*) AS count FROM resume_documents WHERE status = 'QUARANTINED'"), graphEdges: count("SELECT COUNT(*) AS count FROM graph_edges ge JOIN resume_documents r ON r.id = ge.source_resume_id WHERE r.graph_eligible = 1"), openSearchTasks: count("SELECT COUNT(*) AS count FROM search_tasks WHERE status IN ('NEW','CLAIMED','IN_PROGRESS')"), feedbackSamples: count("SELECT COUNT(*) AS count FROM search_task_feedback"), campaigns: listCampaigns().length };
}
