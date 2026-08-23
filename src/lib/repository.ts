import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { db, json, now } from "@/lib/db";
import "@/lib/seed";
import { getAiRuntimeConfig } from "@/lib/settings";
import { canTransitionPersonStatus, isPersonStatus, PERSON_STATUS_LABELS, terminalReasonStatuses } from "@/lib/person-workflow";
import { listActivityEvents, listCandidateOrigins, recordActivityEvent } from "@/lib/autonomy";
import type { AgentTask, Campaign, CampaignOrganization, CampaignPerson, DashboardData, Evidence, OrganizationStatus, PersonStatus } from "@/lib/types";

type Row = Record<string, string | number | null>;

function campaignFrom(row: Row): Campaign {
  return {
    id: String(row.id), name: String(row.name), roleName: String(row.role_name), status: row.status as Campaign["status"], ownerName: String(row.owner_name),
    businessGoal: String(row.business_goal), valueProposition: String(row.value_proposition), locations: json(String(row.locations_json)), markets: json(String(row.markets_json)), channels: json(String(row.channels_json)),
    mustHaves: json(String(row.must_haves_json)), niceToHaves: json(String(row.nice_to_haves_json)), exclusions: json(String(row.exclusions_json)),
    targetOrganizationCount: Number(row.target_organization_count), targetPersonCount: Number(row.target_person_count), weeklyTarget: Number(row.weekly_target), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function evidenceFor(entityType: string, entityId: string, sourceProvider?: string): Evidence[] {
  const providerClause = sourceProvider ? " AND source_provider = ?" : "";
  const values = sourceProvider ? [entityType, entityId, sourceProvider] : [entityType, entityId];
  return (db.prepare(`SELECT * FROM evidence WHERE entity_type = ? AND entity_id = ?${providerClause} ORDER BY classification, confidence DESC`).all(...values) as Row[]).map((row) => ({
    id: String(row.id), entityType: row.entity_type as Evidence["entityType"], entityId: String(row.entity_id), classification: row.classification as Evidence["classification"], claimText: String(row.claim_text), quote: String(row.quote), sourceTitle: String(row.source_title), sourceUrl: String(row.source_url), sourceProvider: String(row.source_provider), confidence: Number(row.confidence), observedAt: String(row.observed_at),
  }));
}

function taskFrom(row: Row): AgentTask {
  return {
    id: String(row.id), campaignId: row.campaign_id ? String(row.campaign_id) : null, campaignName: row.campaign_name ? String(row.campaign_name) : null, type: String(row.type), status: row.status as AgentTask["status"], title: String(row.title), resultSummary: String(row.result_summary), payload: json(String(row.payload_json)), steps: json(String(row.steps_json)), attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), modelName: String(row.model_name), estimatedCost: Number(row.estimated_cost), createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export function listCampaigns() {
  return (db.prepare("SELECT * FROM campaigns ORDER BY updated_at DESC").all() as Row[]).map(campaignFrom);
}

export function getCampaign(id: string) {
  const row = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Row | undefined;
  return row ? campaignFrom(row) : null;
}

export function createCampaign(input: Partial<Campaign>) {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO campaigns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name || "未命名寻访战役", input.roleName || input.name || "待定义岗位", "DRAFT", input.ownerName || "陈晨", input.businessGoal || "待用人经理补充业务目标", input.valueProposition || "待补充候选人价值主张", JSON.stringify(input.locations || ["广州", "深圳", "远程"]), JSON.stringify(input.markets || ["欧美", "东南亚"]), JSON.stringify(input.channels || []), JSON.stringify(input.mustHaves || []), JSON.stringify(input.niceToHaves || []), JSON.stringify(input.exclusions || []), input.targetOrganizationCount || 100, input.targetPersonCount || 150, input.weeklyTarget || 20, timestamp, timestamp);
  createTask({ campaignId: id, type: "GENERATE_STRATEGY", status: "WAITING_REVIEW", title: "确认 AI 搜索策略", resultSummary: "已根据岗位输入生成首轮公司画像、人员槽位与检索建议。", steps: ["确认公司画像", "确认人员槽位", "检查排除项", "激活战役后开始发现"] });
  return getCampaign(id)!;
}

export function updateCampaignStatus(id: string, status: Campaign["status"]) {
  db.prepare("UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  return getCampaign(id);
}

export function listOrganizations(campaignId?: string): CampaignOrganization[] {
  const campaignClause = campaignId ? "AND co.campaign_id = ?" : "";
  const rows = db.prepare(`SELECT co.*, o.name, o.domain, o.location, o.size, o.description
    FROM campaign_organizations co JOIN organizations o ON o.id = co.organization_id
    WHERE EXISTS (
      SELECT 1 FROM employments e JOIN resume_documents r ON r.id = e.resume_id
      WHERE e.organization_id = co.organization_id AND r.campaign_id = co.campaign_id AND r.graph_eligible = 1
    ) ${campaignClause}
    ORDER BY co.fit_score DESC, co.updated_at DESC`).all(...(campaignId ? [campaignId] : [])) as Row[];
  return rows.map((row) => {
    const employments = db.prepare(`SELECT e.person_id, e.raw_title
      FROM employments e JOIN resume_documents r ON r.id = e.resume_id
      WHERE e.organization_id = ? AND r.campaign_id = ? AND r.graph_eligible = 1
      GROUP BY e.person_id, e.raw_title
      ORDER BY MAX(e.is_current) DESC, MIN(e.sequence)`).all(String(row.organization_id), String(row.campaign_id)) as Array<{ person_id: string; raw_title: string }>;
    return ({
    id: String(row.id), campaignId: String(row.campaign_id), organizationId: String(row.organization_id), name: String(row.name), domain: String(row.domain), location: String(row.location), size: String(row.size), description: String(row.description), category: String(row.category), status: row.status as OrganizationStatus,
    products: json(String(row.products_json)), markets: json(String(row.markets_json)), channels: json(String(row.channels_json)), monetization: json(String(row.monetization_json)),
    businessHistory: json(String(row.business_history_json)), currentBusiness: json(String(row.current_business_json)), businessStatus: row.business_status as CampaignOrganization["businessStatus"], businessStatusSummary: String(row.business_status_summary), businessSignals: json(String(row.business_signals_json)), businessStatusConfidence: Number(row.business_status_confidence),
    fitScore: Number(row.fit_score), evidenceCoverage: Number(row.evidence_coverage), confidence: Number(row.confidence), evidenceSourceCount: Number(row.evidence_source_count || 0), sourceQualityScore: Number(row.source_quality_score || 0), recommendationReason: String(row.recommendation_reason), unknowns: json(String(row.unknowns_json)), ownerName: String(row.owner_name), updatedAt: String(row.updated_at), evidence: evidenceFor("ORGANIZATION", String(row.organization_id), "授权简历"),
    talentCount: new Set(employments.map((item) => item.person_id)).size,
    roleNames: [...new Set(employments.map((item) => item.raw_title).filter(Boolean))].slice(0, 8),
  }); });
}

export function updateOrganizationStatus(ids: string[], status: OrganizationStatus, reason = "") {
  if (!["AI_LEARNED", "WATCHLIST", "REJECTED"].includes(status)) throw new Error("公司状态无效");
  const update = db.prepare("UPDATE campaign_organizations SET status = ?, review_reason = ?, owner_name = CASE WHEN owner_name = '待分配' THEN '陈晨' ELSE owner_name END, updated_at = ? WHERE id = ?");
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of ids) {
      update.run(status, reason, timestamp, id);
      const row = db.prepare("SELECT campaign_id, organization_id FROM campaign_organizations WHERE id = ?").get(id) as Row;
      db.prepare("INSERT INTO feedback VALUES (?, ?, 'ORGANIZATION', ?, ?, ?, '', '当前用户', ?)").run(randomUUID(), row.campaign_id, row.organization_id, status, reason, timestamp);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return ids.length;
}

export function listPeople(campaignId?: string): CampaignPerson[] {
  const where = `WHERE EXISTS (SELECT 1 FROM resume_documents r WHERE r.person_id = cp.person_id AND r.campaign_id = cp.campaign_id AND r.graph_eligible = 1)${campaignId ? " AND cp.campaign_id = ?" : ""}`;
  const rows = db.prepare(`SELECT cp.*, p.name, p.headline, p.location, o.name AS organization_name FROM campaign_people cp JOIN people p ON p.id = cp.person_id JOIN organizations o ON o.id = cp.organization_id ${where} ORDER BY cp.fit_score DESC, cp.updated_at DESC`).all(...(campaignId ? [campaignId] : [])) as Row[];
  return rows.map((row) => {
    const history = db.prepare(`SELECT id, action, reason_code, note, operator_name, created_at
      FROM feedback WHERE campaign_id = ? AND entity_type = 'PERSON' AND entity_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 50`).all(String(row.campaign_id), String(row.person_id)) as Row[];
    return {
      id: String(row.id), campaignId: String(row.campaign_id), personId: String(row.person_id), name: String(row.name), headline: String(row.headline), location: String(row.location), organizationName: String(row.organization_name), slot: String(row.slot), status: row.status as PersonStatus, fitScore: Number(row.fit_score), evidenceCoverage: Number(row.evidence_coverage), identityConfidence: Number(row.identity_confidence), recommendationReason: String(row.recommendation_reason), strengths: json(String(row.strengths_json)), unknowns: json(String(row.unknowns_json)), riskFlags: json(String(row.risk_flags_json)), ownerName: String(row.owner_name), reviewReason: String(row.review_reason), lastInteractionAt: row.last_interaction_at ? String(row.last_interaction_at) : null, updatedAt: String(row.updated_at), evidence: evidenceFor("PERSON", String(row.person_id)),
      stageHistory: history.map((event) => ({ id: String(event.id), status: String(event.action), reason: String(event.note || (event.reason_code === "WORKFLOW_TRANSITION" ? "" : event.reason_code) || ""), operatorName: String(event.operator_name), createdAt: String(event.created_at) })),
      origins: listCandidateOrigins(String(row.person_id), String(row.campaign_id)),
      activityEvents: listActivityEvents({ campaignId: String(row.campaign_id), personId: String(row.person_id), limit: 50 }),
    };
  });
}

export function reviewPeople(ids: string[], status: PersonStatus, reason = "", operatorName = "当前用户") {
  if (!isPersonStatus(status)) throw new Error("候选人状态无效");
  if (terminalReasonStatuses.has(status) && !reason.trim()) throw new Error(`转入“${PERSON_STATUS_LABELS[status]}”时必须填写原因`);
  const timestamp = now();
  const update = db.prepare("UPDATE campaign_people SET status = ?, review_reason = ?, last_interaction_at = CASE WHEN ? IN ('CONTACTED','ENGAGED','SCREENING','CONVERTED','INTERVIEWING','OFFERED','HIRED') THEN ? ELSE last_interaction_at END, updated_at = ? WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of ids) {
      const row = db.prepare("SELECT campaign_id, person_id, status FROM campaign_people WHERE id = ?").get(id) as Row | undefined;
      if (!row) throw new Error("候选人记录不存在");
      const currentStatus = String(row.status);
      if (!isPersonStatus(currentStatus)) throw new Error(`候选人当前状态 ${currentStatus} 无法识别`);
      if (currentStatus === status) continue;
      if (!canTransitionPersonStatus(currentStatus, status)) throw new Error(`不能从“${PERSON_STATUS_LABELS[currentStatus]}”直接变更为“${PERSON_STATUS_LABELS[status]}”`);
      update.run(status, reason, status, timestamp, timestamp, id);
      db.prepare(`INSERT INTO feedback (id, campaign_id, entity_type, entity_id, action, reason_code, note, operator_name, created_at)
        VALUES (?, ?, 'PERSON', ?, ?, 'WORKFLOW_TRANSITION', ?, ?, ?)`)
        .run(randomUUID(), row.campaign_id, row.person_id, status, reason.trim(), operatorName, timestamp);
      const eventType = status === "CONTACTED" ? "CONTACT_RECORDED"
        : status === "ENGAGED" ? "REPLY_RECORDED"
          : status === "INTERVIEWING" ? "INTERVIEW_RECORDED"
            : status === "OFFERED" ? "OFFER_RECORDED"
              : status === "HIRED" ? "HIRED_RECORDED"
                : ["CLOSED", "DO_NOT_CONTACT"].includes(status) ? "CANDIDATE_REJECTED"
                  : "CANDIDATE_STAGE_CHANGED";
      const origin = db.prepare(`SELECT search_task_id, strategy_version_id, experiment_assignment_id, organization_id
        FROM candidate_origins WHERE campaign_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1`).get(row.campaign_id, row.person_id) as Row | undefined;
      recordActivityEvent({ campaignId: String(row.campaign_id), personId: String(row.person_id), organizationId: origin?.organization_id ? String(origin.organization_id) : null,
        searchTaskId: origin?.search_task_id ? String(origin.search_task_id) : null, strategyVersionId: origin?.strategy_version_id ? String(origin.strategy_version_id) : null,
        experimentAssignmentId: origin?.experiment_assignment_id ? String(origin.experiment_assignment_id) : null,
        eventType, fromStatus: currentStatus, toStatus: status, reasonCode: "WORKFLOW_TRANSITION", actorType: "USER", actorId: operatorName,
        payload: { reason: reason.trim() }, occurredAt: timestamp, idempotencyKey: `candidate-stage:${id}:${status}:${timestamp}` });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return ids.length;
}

export function createTask(input: { campaignId?: string; type: string; status?: AgentTask["status"]; title: string; resultSummary?: string; payload?: Record<string, unknown>; steps?: string[]; idempotencyKey?: string }) {
  const id = randomUUID();
  const timestamp = now();
  const ai = getAiRuntimeConfig();
  db.prepare(`INSERT INTO tasks (id, campaign_id, type, status, title, result_summary, payload_json, steps_json, attempts, max_attempts, model_name, estimated_cost, idempotency_key, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 3, ?, 0, ?, ?, ?)`)
    .run(id, input.campaignId || null, input.type, input.status || "QUEUED", input.title, input.resultSummary || "等待执行", JSON.stringify(input.payload || {}), JSON.stringify(input.steps || []), ai.enabled ? ai.model : "deterministic-fallback", input.idempotencyKey || null, timestamp, input.status === "SUCCEEDED" ? timestamp : null);
  return getTask(id)!;
}

export function getTask(id: string) {
  const row = db.prepare("SELECT t.*, c.name AS campaign_name FROM tasks t LEFT JOIN campaigns c ON c.id = t.campaign_id WHERE t.id = ?").get(id) as Row | undefined;
  return row ? taskFrom(row) : null;
}

export function listTasks() {
  return (db.prepare("SELECT t.*, c.name AS campaign_name FROM tasks t LEFT JOIN campaigns c ON c.id = t.campaign_id ORDER BY t.created_at DESC").all() as Row[]).map(taskFrom);
}

export function updateTask(id: string, status: AgentTask["status"], resultSummary: string, steps?: string[]) {
  db.prepare("UPDATE tasks SET status = ?, result_summary = ?, steps_json = COALESCE(?, steps_json), attempts = attempts + 1, completed_at = ? WHERE id = ?").run(status, resultSummary, steps ? JSON.stringify(steps) : null, ["SUCCEEDED", "FAILED", "WAITING_REVIEW"].includes(status) ? now() : null, id);
  return getTask(id);
}

export function importSource(input: { campaignId: string; provider: string; title: string; sourceUrl?: string; text: string; importedCount: number }) {
  const hash = createHash("sha256").update(input.text.trim()).digest("hex");
  const id = randomUUID();
  const result = db.prepare(`INSERT OR IGNORE INTO sources (id, campaign_id, provider, title, source_type, source_url, content_hash, extracted_text, imported_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.campaignId, input.provider, input.title, input.sourceUrl ? "URL_OR_TEXT" : "TEXT_OR_CSV", input.sourceUrl || "", hash, input.text.slice(0, 100000), input.importedCount, now());
  return { id, duplicate: result.changes === 0 };
}

export function listSources() {
  return db.prepare("SELECT s.*, c.name AS campaign_name FROM sources s LEFT JOIN campaigns c ON c.id = s.campaign_id ORDER BY s.created_at DESC").all() as Row[];
}

export function getDashboard(): DashboardData {
  const campaigns = listCampaigns().map((campaign) => ({
    ...campaign,
    organizationCount: Number((db.prepare("SELECT COUNT(*) AS count FROM campaign_organizations WHERE campaign_id = ?").get(campaign.id) as Row).count),
    personCount: Number((db.prepare("SELECT COUNT(*) AS count FROM campaign_people WHERE campaign_id = ?").get(campaign.id) as Row).count),
  }));
  const count = (sql: string) => Number((db.prepare(sql).get() as Row).count);
  const highMatchEngaged = count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('ENGAGED','SCREENING','CONVERTED','INTERVIEWING','OFFERED','HIRED') AND fit_score >= 80");
  return {
    metrics: {
      learnedCompanies: count("SELECT COUNT(*) AS count FROM campaign_organizations WHERE status <> 'REJECTED'"),
      pendingPeople: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('PENDING_REVIEW','NEEDS_RESEARCH')"),
      readyToContact: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status = 'READY_TO_CONTACT'"),
      highMatchEngaged,
      weeklyGoal: campaigns.reduce((sum, item) => sum + item.weeklyTarget, 0),
      estimatedHoursSaved: Math.round((count("SELECT COUNT(*) AS count FROM campaign_people") * 22) / 60),
    },
    campaigns,
    urgentTasks: listTasks().filter((task) => ["WAITING_HUMAN", "FAILED"].includes(task.status)).slice(0, 4),
    recentPeople: listPeople().slice(0, 4),
    funnel: [
      { label: "已发现", value: count("SELECT COUNT(*) AS count FROM campaign_people"), color: "#265e56" },
      { label: "进入触达", value: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('READY_TO_CONTACT','CONTACTED','ENGAGED','SCREENING','CONVERTED','INTERVIEWING','OFFERED','HIRED')"), color: "#bc6b32" },
      { label: "已联系", value: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('CONTACTED','ENGAGED','SCREENING','CONVERTED','INTERVIEWING','OFFERED','HIRED')"), color: "#3e6f9e" },
      { label: "有效沟通", value: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('ENGAGED','SCREENING','CONVERTED','INTERVIEWING','OFFERED','HIRED')"), color: "#6d5c8e" },
      { label: "进入面试", value: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('INTERVIEWING','OFFERED','HIRED')"), color: "#5b7f73" },
      { label: "Offer", value: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status IN ('OFFERED','HIRED')"), color: "#ad7a32" },
      { label: "已入职", value: count("SELECT COUNT(*) AS count FROM campaign_people WHERE status = 'HIRED'"), color: "#347557" },
    ],
  };
}
