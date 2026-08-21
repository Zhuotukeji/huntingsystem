import { createHash, randomUUID } from "node:crypto";
import { db, json, now } from "@/lib/db";
import { analyzeResumeWithAi, type ResumeAnalysis } from "@/lib/llm";
import { getCampaign, listCampaigns } from "@/lib/repository";
import { preferredCandidateName, resolveResumeIdentity, type ResumeIdentityResolution } from "@/lib/resume-identity";
import { getPendingResumeIds, getResumeText } from "@/lib/resumes";
import type { AiRun, GraphData, LearningRecommendation, SearchTask } from "@/lib/types";

type Row = Record<string, string | number | null>;

const PARSE_VERSION = "resume-graph-v2";
const searchTaskLifetimeDays = 14;

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s·•.,，。()（）\[\]【】_-]/g, "").replace(/(有限责任公司|股份有限公司|有限公司|科技|网络)$/g, "");
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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
  return {
    id: String(row.id), campaignId: String(row.campaign_id), campaignName: String(row.campaign_name || ""), runId: row.run_id ? String(row.run_id) : null,
    taskType: String(row.task_type), title: String(row.title), companyName: String(row.company_name), query: json(String(row.query_json)), reason: json(String(row.reason_json)),
    priority: Number(row.priority), status: row.status as SearchTask["status"], claimedBy: row.claimed_by ? String(row.claimed_by) : null,
    expiresAt: String(row.expires_at), createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function recommendationFrom(row: Row): LearningRecommendation {
  return {
    id: String(row.id), campaignId: String(row.campaign_id), runId: row.run_id ? String(row.run_id) : null,
    recommendationType: String(row.recommendation_type), title: String(row.title), reason: String(row.reason), payload: json(String(row.payload_json)),
    confidence: Number(row.confidence), status: row.status as LearningRecommendation["status"], createdAt: String(row.created_at),
  };
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
    employments.push({ company, aliases: [], title, normalizedRole: title, startDate: match[1] || null, endDate: match[2] || null, isCurrent: /至今|present/i.test(match[2] || ""), summary: match[5]?.trim() || "", location: "", industry: "", businessTags: [], markets: [], channels: [], confidence: 0.72 });
  }
  const sourceSkills = field(["技能", "skills"]).split(/[、,，/|；;]/).map((item) => item.trim()).filter(Boolean);
  const campaignSignals = [...campaign.channels, ...campaign.markets, ...campaign.mustHaves, ...campaign.niceToHaves];
  const matchedSignals = campaignSignals.filter((signal) => text.toLowerCase().includes(signal.toLowerCase()));
  const skills = [...new Set([...sourceSkills, ...matchedSignals])].slice(0, 30).map((name) => ({ name, category: "OTHER" as const, evidence: `简历正文包含“${name}”`, confidence: 0.7 }));
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

function findOrCreateOrganization(employment: ResumeAnalysis["employments"][number], resumeId: string) {
  const normalizedName = normalize(employment.company);
  let organization = db.prepare("SELECT id FROM organizations WHERE normalized_name = ?").get(normalizedName) as { id: string } | undefined;
  const timestamp = now();
  if (!organization) {
    organization = { id: randomUUID() };
    db.prepare("INSERT INTO organizations (id, name, normalized_name, domain, location, size, description, identity_confidence, created_at) VALUES (?, ?, ?, '', ?, '待确认', ?, ?, ?)")
      .run(organization.id, employment.company, normalizedName, employment.location || "待确认", employment.summary || "由已授权简历中的任职经历发现。", employment.confidence, timestamp);
  }
  const facts: Array<[string, unknown]> = [
    ["aliases", employment.aliases], ["industry", employment.industry], ["business_tags", employment.businessTags], ["markets", employment.markets], ["channels", employment.channels],
  ];
  const upsertFact = db.prepare(`INSERT INTO organization_facts (id, organization_id, field_name, value_json, confidence, source_resume_id, status, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 'EVIDENCE_BACKED', ?, ?)
    ON CONFLICT(organization_id, field_name, value_json, source_resume_id) DO UPDATE SET confidence = excluded.confidence, last_seen_at = excluded.last_seen_at`);
  for (const [fieldName, value] of facts) {
    if ((Array.isArray(value) && !value.length) || !value) continue;
    upsertFact.run(randomUUID(), organization.id, fieldName, JSON.stringify(value), employment.confidence, resumeId, timestamp, timestamp);
  }
  return organization.id;
}

function calculateOrganizationScore(campaignId: string, employment: ResumeAnalysis["employments"][number]) {
  const campaign = getCampaign(campaignId)!;
  const text = [employment.title, employment.summary, ...employment.businessTags, ...employment.markets, ...employment.channels].join(" ").toLowerCase();
  const signals = [...campaign.channels, ...campaign.markets];
  const hits = signals.filter((signal) => text.includes(signal.toLowerCase())).length;
  return bounded(Math.round(55 + (signals.length ? hits / signals.length : 0) * 30 + employment.confidence * 10), 40, 95);
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

function persistResumeAnalysis(resumeId: string, campaignId: string, analysis: ResumeAnalysis) {
  const timestamp = now();
  const existingResume = db.prepare("SELECT person_id, file_name FROM resume_documents WHERE id = ?").get(resumeId) as { person_id: string | null; file_name: string };
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
  db.prepare("DELETE FROM evidence WHERE source_url = ?").run(`resume:${resumeId}`);

  let currentOrganizationId = "";
  const companyNames: string[] = [];
  for (const [index, employment] of analysis.employments.entries()) {
    const organizationId = findOrCreateOrganization(employment, resumeId);
    if (employment.isCurrent || !currentOrganizationId) currentOrganizationId = organizationId;
    companyNames.push(employment.company);
    db.prepare(`INSERT INTO employments (id, person_id, organization_id, resume_id, sequence, raw_company_name, raw_title, normalized_role, start_date, end_date, is_current, summary, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), personId, organizationId, resumeId, index, employment.company, employment.title, employment.normalizedRole, employment.startDate, employment.endDate, employment.isCurrent ? 1 : 0, employment.summary, employment.confidence, timestamp);
    db.prepare(`INSERT INTO graph_edges (id, from_type, from_id, edge_type, to_type, to_id, weight, confidence, source_resume_id, first_seen_at, last_seen_at)
      VALUES (?, 'PERSON', ?, ?, 'ORGANIZATION', ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), personId, employment.isCurrent ? "CURRENTLY_WORKS_AT" : "WORKED_AT", organizationId, employment.isCurrent ? 1 : 0.7, employment.confidence, resumeId, timestamp, timestamp);
    const organizationScore = calculateOrganizationScore(campaignId, employment);
    db.prepare(`INSERT INTO campaign_organizations (id, campaign_id, organization_id, category, status, products_json, markets_json, channels_json, monetization_json, fit_score, evidence_coverage, confidence, recommendation_reason, unknowns_json, owner_name, updated_at)
      VALUES (?, ?, ?, '简历反向发现', 'PENDING_REVIEW', '[]', ?, ?, '[]', ?, ?, ?, ?, ?, '待分配', ?)
      ON CONFLICT(campaign_id, organization_id) DO UPDATE SET markets_json = excluded.markets_json, channels_json = excluded.channels_json, fit_score = MAX(campaign_organizations.fit_score, excluded.fit_score), evidence_coverage = MAX(campaign_organizations.evidence_coverage, excluded.evidence_coverage), confidence = MAX(campaign_organizations.confidence, excluded.confidence), recommendation_reason = excluded.recommendation_reason, updated_at = excluded.updated_at`)
      .run(randomUUID(), campaignId, organizationId, JSON.stringify(employment.markets), JSON.stringify(employment.channels), organizationScore, Math.round(employment.confidence * 100), Math.round(employment.confidence * 100), `${employment.company}由授权简历中的任职关系发现，岗位为${employment.title}。`, JSON.stringify(["公司业务规模待人工验证"]), timestamp);
    db.prepare("INSERT INTO evidence (id, entity_type, entity_id, classification, claim_text, quote, source_title, source_url, source_provider, confidence, observed_at) VALUES (?, 'ORGANIZATION', ?, 'FACT', ?, ?, ?, ?, '授权简历', ?, ?)")
      .run(randomUUID(), organizationId, `${analysis.person.name}曾任职于${employment.company}`, `${employment.title}：${employment.summary || "简历中列明该任职关系"}`, existingResume.file_name, `resume:${resumeId}`, employment.confidence, timestamp);
  }

  for (const skill of analysis.skills) {
    const skillName = normalize(skill.name);
    let skillRow = db.prepare("SELECT id FROM skills WHERE normalized_name = ?").get(skillName) as { id: string } | undefined;
    if (!skillRow) {
      skillRow = { id: randomUUID() };
      db.prepare("INSERT INTO skills (id, name, normalized_name, category, created_at) VALUES (?, ?, ?, ?, ?)").run(skillRow.id, skill.name, skillName, skill.category, timestamp);
    }
    db.prepare("INSERT INTO person_skills (id, person_id, skill_id, resume_id, confidence, evidence_text, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), personId, skillRow.id, resumeId, skill.confidence, skill.evidence, timestamp);
    db.prepare(`INSERT INTO graph_edges (id, from_type, from_id, edge_type, to_type, to_id, weight, confidence, source_resume_id, first_seen_at, last_seen_at)
      VALUES (?, 'PERSON', ?, 'HAS_SKILL', 'SKILL', ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), personId, skillRow.id, skill.confidence, skill.confidence, resumeId, timestamp, timestamp);
  }

  if (!currentOrganizationId) {
    const unknown = db.prepare("SELECT id FROM organizations WHERE normalized_name = '待核实任职公司'").get() as { id: string } | undefined;
    currentOrganizationId = unknown?.id || randomUUID();
    if (!unknown) db.prepare("INSERT INTO organizations VALUES (?, '待核实任职公司', '待核实任职公司', '', '待确认', '待确认', '简历未能可靠解析任职公司。', 0.2, ?)").run(currentOrganizationId, timestamp);
  }
  const evidenceCoverage = bounded(Math.round((analysis.employments.length ? 45 : 20) + Math.min(analysis.skills.length, 10) * 4), 20, 90);
  db.prepare(`INSERT INTO campaign_people (id, campaign_id, person_id, organization_id, slot, status, fit_score, evidence_coverage, identity_confidence, recommendation_reason, strengths_json, unknowns_json, risk_flags_json, owner_name, review_reason, last_interaction_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, '[]', '待分配', ?, NULL, ?)
    ON CONFLICT(campaign_id, person_id) DO UPDATE SET organization_id = excluded.organization_id, slot = excluded.slot, fit_score = excluded.fit_score, evidence_coverage = excluded.evidence_coverage, identity_confidence = MAX(campaign_people.identity_confidence, excluded.identity_confidence), recommendation_reason = excluded.recommendation_reason, strengths_json = excluded.strengths_json, unknowns_json = excluded.unknowns_json, review_reason = CASE WHEN excluded.review_reason <> '' THEN excluded.review_reason ELSE campaign_people.review_reason END, updated_at = excluded.updated_at`)
    .run(randomUUID(), campaignId, personId, currentOrganizationId, analysis.person.headline || getCampaign(campaignId)!.roleName, Math.round(analysis.match.score), evidenceCoverage, Math.round(identity.confidence * 100), analysis.match.rationale, JSON.stringify(analysis.match.strengths), JSON.stringify(analysis.match.gaps), identity.decision === "REVIEW_REQUIRED" ? identity.reasons[0] : "", timestamp);
  db.prepare("INSERT INTO evidence (id, entity_type, entity_id, classification, claim_text, quote, source_title, source_url, source_provider, confidence, observed_at) VALUES (?, 'PERSON', ?, 'FACT', ?, ?, ?, ?, '授权简历', ?, ?)")
    .run(randomUUID(), personId, `解析到 ${companyNames.length} 段任职经历和 ${analysis.skills.length} 项技能`, analysis.person.summary || analysis.person.headline, existingResume.file_name, `resume:${resumeId}`, 0.85, timestamp);
  db.prepare("UPDATE resume_documents SET person_id = ?, status = 'READY', parse_version = ?, error_message = '', analyzed_at = ?, updated_at = ? WHERE id = ?")
    .run(personId, PARSE_VERSION, timestamp, timestamp, resumeId);
  db.prepare(`INSERT INTO resume_identity_matches
    (resume_id, person_id, matched_person_id, decision, score, confidence, reasons_json, candidate_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(resume_id) DO UPDATE SET person_id = excluded.person_id, matched_person_id = excluded.matched_person_id, decision = excluded.decision, score = excluded.score, confidence = excluded.confidence, reasons_json = excluded.reasons_json, candidate_count = excluded.candidate_count, updated_at = excluded.updated_at`)
    .run(resumeId, personId, identity.personId, identity.decision, identity.score, identity.confidence, JSON.stringify(identity.reasons), identity.candidateCount, timestamp, timestamp);
  return { personId, identity };
}

function weightFor(campaignId: string, signalType: string, signalKey: string) {
  const row = db.prepare("SELECT weight FROM learning_weights WHERE campaign_id = ? AND signal_type = ? AND signal_key = ?").get(campaignId, signalType, signalKey) as { weight: number } | undefined;
  return row?.weight || 1;
}

function generateSearchTasks(campaignId: string, runId: string) {
  const campaign = getCampaign(campaignId)!;
  const organizations = db.prepare(`SELECT co.organization_id, o.name, o.location, co.fit_score, co.recommendation_reason,
    COALESCE((SELECT GROUP_CONCAT(DISTINCT e.normalized_role) FROM employments e WHERE e.organization_id = o.id), '') AS roles
    FROM campaign_organizations co JOIN organizations o ON o.id = co.organization_id
    WHERE co.campaign_id = ? AND o.normalized_name <> '待核实任职公司' ORDER BY co.fit_score DESC LIMIT 30`).all(campaignId) as Row[];
  const timestamp = now();
  const expires = new Date(Date.now() + searchTaskLifetimeDays * 86_400_000).toISOString();
  const period = chinaBusinessDate().slice(0, 7);
  let created = 0;
  for (const organization of organizations) {
    const roles = String(organization.roles || "").split(",").filter(Boolean);
    const roleKeywords = [...new Set([campaign.roleName, ...roles, "海外业务负责人", "海外增长负责人", "商业化负责人"])]
      .sort((left, right) => weightFor(campaignId, "KEYWORD", right) - weightFor(campaignId, "KEYWORD", left))
      .slice(0, 5);
    const companyWeight = weightFor(campaignId, "COMPANY", String(organization.name));
    const priority = bounded(Math.round(Number(organization.fit_score) * companyWeight), 1, 100);
    const dedupeKey = createHash("sha256").update(`${campaignId}|${organization.organization_id}|${roleKeywords.join("|")}|${period}`).digest("hex");
    const result = db.prepare(`INSERT OR IGNORE INTO search_tasks (id, campaign_id, run_id, task_type, title, company_name, query_json, reason_json, priority, dedupe_key, status, claimed_by, expires_at, created_at, completed_at)
      VALUES (?, ?, ?, 'BOSS_MANUAL_SEARCH', ?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?, NULL)`)
      .run(randomUUID(), campaignId, runId, `在 BOSS 搜索 ${organization.name} 的目标负责人`, organization.name,
        JSON.stringify({ keywords: roleKeywords, locations: campaign.locations, experience: "优先 5 年以上及负责人经历", instructions: ["复制公司名与一个职位关键词到 BOSS 搜索", "由 HR 手工调整筛选条件并查看当前结果", "需要辅助判断时，在插件中主动截取当前可见页面", "完成后填写结果数、合格数和有效沟通数"] }),
        JSON.stringify({ summary: String(organization.recommendation_reason), evidence: [`来自简历库的任职关系与公司证据，当前公司匹配分 ${organization.fit_score}`], expectedCandidate: campaign.mustHaves.slice(0, 3).join("；") }),
        priority, dedupeKey, expires, timestamp);
    created += Number(result.changes);
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
  const runningMetrics = { inputResumes: resumeIds.length, processed: 0, analyzed: 0, failed: 0, identityMerged: 0, identityReviewRequired: 0, searchTasks: 0 };
  const initialSummary = resumeIds.length ? `准备分析 ${resumeIds.length} 份简历。` : "没有待分析简历，准备根据现有图谱生成搜索任务。";
  const claimed = db.prepare("UPDATE ai_runs SET status = 'RUNNING', stage = 'ANALYZE_RESUMES', summary = ?, metrics_json = ?, started_at = ?, error_message = '' WHERE id = ? AND status IN ('QUEUED','FAILED','PARTIAL_SUCCESS')")
    .run(initialSummary, JSON.stringify(runningMetrics), timestamp, id);
  if (!claimed.changes) return getAiRun(id)!;
  let analyzed = 0;
  let failed = 0;
  let identityMerged = 0;
  let identityReviewRequired = 0;
  let tasksCreated = 0;
  const affectedCampaigns = new Set<string>();
  for (const resumeId of resumeIds) {
    const resume = db.prepare("SELECT campaign_id FROM resume_documents WHERE id = ?").get(resumeId) as { campaign_id: string } | undefined;
    if (!resume) continue;
    affectedCampaigns.add(resume.campaign_id);
    db.prepare("INSERT OR IGNORE INTO ai_run_items (id, run_id, entity_type, entity_id, status, attempts, result_json, error_message) VALUES (?, ?, 'RESUME', ?, 'QUEUED', 0, '{}', '')").run(randomUUID(), id, resumeId);
    db.prepare("UPDATE ai_run_items SET status = 'RUNNING', attempts = attempts + 1, started_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?").run(now(), id, resumeId);
    db.prepare("UPDATE resume_documents SET status = 'PROCESSING', error_message = '' WHERE id = ?").run(resumeId);
    try {
      const campaign = getCampaign(resume.campaign_id)!;
      const text = getResumeText(resumeId);
      const analysis = await analyzeResumeWithAi(campaign, text) || fallbackResumeAnalysis(text, resume.campaign_id);
      db.exec("BEGIN IMMEDIATE");
      try {
        const persisted = persistResumeAnalysis(resumeId, resume.campaign_id, analysis);
        if (persisted.identity.decision === "AUTO_MERGED") identityMerged += 1;
        if (persisted.identity.decision === "REVIEW_REQUIRED") identityReviewRequired += 1;
        db.prepare("UPDATE ai_run_items SET status = 'SUCCEEDED', result_json = ?, completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?")
          .run(JSON.stringify({ person: analysis.person.name, personId: persisted.personId, employments: analysis.employments.length, skills: analysis.skills.length, score: analysis.match.score, identity: persisted.identity }), now(), id, resumeId);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      analyzed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "简历分析失败";
      db.prepare("UPDATE resume_documents SET status = 'FAILED', error_message = ?, updated_at = ? WHERE id = ?").run(message, now(), resumeId);
      db.prepare("UPDATE ai_run_items SET status = 'FAILED', error_message = ?, completed_at = ? WHERE run_id = ? AND entity_type = 'RESUME' AND entity_id = ?").run(message, now(), id, resumeId);
      failed += 1;
    }
    const processed = analyzed + failed;
    db.prepare("UPDATE ai_runs SET summary = ?, metrics_json = ? WHERE id = ?")
      .run(`正在分析简历：${processed} / ${resumeIds.length}，成功 ${analyzed} 份，失败 ${failed} 份。`, JSON.stringify({ ...runningMetrics, processed, analyzed, failed, identityMerged, identityReviewRequired }), id);
  }
  if (scope.campaignId) affectedCampaigns.add(scope.campaignId);
  else for (const campaign of listCampaigns().filter((item) => item.status === "ACTIVE")) affectedCampaigns.add(campaign.id);
  db.prepare("UPDATE ai_runs SET stage = 'GENERATE_SEARCH_TASKS', summary = ?, metrics_json = ? WHERE id = ?")
    .run("简历分析已完成，正在根据图谱生成 BOSS 搜索任务。", JSON.stringify({ ...runningMetrics, processed: analyzed + failed, analyzed, failed, identityMerged, identityReviewRequired }), id);
  for (const campaignId of affectedCampaigns) tasksCreated += generateSearchTasks(campaignId, id);
  const status = failed && analyzed ? "PARTIAL_SUCCESS" : failed ? "FAILED" : "SUCCEEDED";
  const identitySummary = identityMerged || identityReviewRequired ? ` 自动合并 ${identityMerged} 份至现有人选，${identityReviewRequired} 份近似档案待复核。` : "";
  const summary = resumeIds.length ? `完成 ${analyzed} 份简历分析，失败 ${failed} 份。${identitySummary}生成 ${tasksCreated} 个 BOSS 人工搜索任务。` : `没有待分析简历，基于现有图谱生成 ${tasksCreated} 个新搜索任务。`;
  db.prepare("UPDATE ai_runs SET status = ?, stage = 'COMPLETED', summary = ?, metrics_json = ?, output_watermark = ?, completed_at = ? WHERE id = ?")
    .run(status, summary, JSON.stringify({ inputResumes: resumeIds.length, processed: analyzed + failed, analyzed, failed, identityMerged, identityReviewRequired, searchTasks: tasksCreated }), now(), now(), id);
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
  const row = db.prepare("SELECT status FROM search_tasks WHERE id = ?").get(id) as { status: SearchTask["status"] } | undefined;
  if (!row) throw new Error("搜索任务不存在");
  if (row.status === status) return updateSearchTask(id, { claimedBy: actor });
  if (!pluginTransitions[row.status].includes(status)) throw new Error(`任务不能从 ${row.status} 变更为 ${status}`);
  return updateSearchTask(id, { status, claimedBy: actor });
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
      const posterior = (positiveCount + 2) / (sampleCount + 4);
      const oldWeight = Number(current?.weight || 1);
      const proposed = bounded(0.65 + posterior * 0.7, 0.65, 1.35);
      const weight = bounded(oldWeight * 0.8 + proposed * 0.2, oldWeight - 0.08, oldWeight + 0.08);
      db.prepare(`INSERT INTO learning_weights (id, campaign_id, signal_type, signal_key, sample_count, positive_count, weight, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, signal_type, signal_key) DO UPDATE SET sample_count = excluded.sample_count, positive_count = excluded.positive_count, weight = excluded.weight, updated_at = excluded.updated_at`)
        .run(randomUUID(), task.campaign_id, signalType, signalKey, sampleCount, positiveCount, weight, timestamp);
      return { sampleCount, weight };
    };
    const companyLearning = updateSignal("COMPANY", companyName);
    const taskQuery = json<{ keywords?: string[] }>(String(task.query_json));
    for (const keyword of taskQuery.keywords || []) updateSignal("KEYWORD", keyword);
    const sampleCount = companyLearning.sampleCount;
    const newWeight = companyLearning.weight;
    if (sampleCount >= 3) {
      const confidence = bounded(sampleCount / 10, 0.3, 0.95);
      db.prepare(`INSERT INTO learning_recommendations (id, campaign_id, run_id, recommendation_type, title, reason, payload_json, confidence, status, created_at, reviewed_at)
        VALUES (?, ?, ?, 'COMPANY_SIGNAL', ?, ?, ?, ?, 'AUTO_APPLIED', ?, NULL)`)
        .run(randomUUID(), task.campaign_id, task.run_id, `${companyName} 搜索信号建议`, `累计 ${sampleCount} 次任务，合格 ${qualifiedCount} 人，有效沟通 ${conversations} 人。`, JSON.stringify({ companyName, weight: Number(newWeight.toFixed(3)), sampleCount }), confidence, timestamp);
    }
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
    WHERE EXISTS (SELECT 1 FROM resume_documents r WHERE r.person_id = p.id AND r.campaign_id = cp.campaign_id) ${campaignFilter}`).all(...args) as Row[];
  const organizations = db.prepare(`SELECT DISTINCT o.id, o.name, o.location, co.fit_score, co.status
    FROM organizations o JOIN campaign_organizations co ON co.organization_id = o.id
    WHERE o.normalized_name <> '待核实任职公司'
      AND EXISTS (
        SELECT 1 FROM employments e JOIN resume_documents r ON r.id = e.resume_id
        WHERE e.organization_id = o.id AND r.campaign_id = co.campaign_id
      ) ${campaignId ? "AND co.campaign_id = ?" : ""}`).all(...args) as Row[];
  const personIds = new Set(people.map((row) => String(row.id)));
  const organizationIds = new Set(organizations.map((row) => String(row.id)));
  const rawEdges = db.prepare("SELECT * FROM graph_edges ORDER BY confidence DESC LIMIT 3000").all() as Row[];
  const edges = rawEdges.filter((row) => personIds.has(String(row.from_id)) && (String(row.to_type) === "SKILL" || organizationIds.has(String(row.to_id))));
  const skillIds = [...new Set(edges.filter((row) => String(row.to_type) === "SKILL").map((row) => String(row.to_id)))];
  const skills = skillIds.length ? db.prepare(`SELECT * FROM skills WHERE id IN (${skillIds.map(() => "?").join(",")})`).all(...skillIds) as Row[] : [];
  const talentCounts = db.prepare(`SELECT o.id, o.name, COUNT(DISTINCT e.person_id) AS talent_count, COUNT(DISTINCT CASE WHEN e.normalized_role LIKE '%负责人%' OR e.normalized_role LIKE '%总监%' OR e.normalized_role LIKE '%manager%' OR e.normalized_role LIKE '%lead%' THEN e.person_id END) AS target_count, MAX(co.fit_score) AS score
    FROM organizations o
    JOIN campaign_organizations co ON co.organization_id = o.id
    JOIN employments e ON e.organization_id = o.id
    JOIN resume_documents r ON r.id = e.resume_id AND r.campaign_id = co.campaign_id
    ${campaignId ? "WHERE co.campaign_id = ?" : ""} GROUP BY o.id, o.name ORDER BY score DESC, talent_count DESC LIMIT 50`).all(...args) as Row[];
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
  return { resumes: count("SELECT COUNT(*) AS count FROM resume_documents"), pendingResumes: count("SELECT COUNT(*) AS count FROM resume_documents WHERE status IN ('PENDING','FAILED','NEEDS_REVIEW')"), graphEdges: count("SELECT COUNT(*) AS count FROM graph_edges"), openSearchTasks: count("SELECT COUNT(*) AS count FROM search_tasks WHERE status IN ('NEW','CLAIMED','IN_PROGRESS')"), feedbackSamples: count("SELECT COUNT(*) AS count FROM search_task_feedback"), campaigns: listCampaigns().length };
}
