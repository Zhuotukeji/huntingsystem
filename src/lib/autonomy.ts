import { createHash, randomUUID } from "node:crypto";
import { db, json, now } from "@/lib/db";
import { getAiRuntimeConfig, getAutonomySettings, getCandidateAutomationSettings } from "@/lib/settings";
import { researchOrganizationWithWebSearch } from "@/lib/llm";
import type {
  ActivityEvent,
  ActivityEventType,
  CandidateOrigin,
  EvidenceClaim,
  Experiment,
  IntelligenceProject,
  IntelligenceSource,
  OrganizationEvent,
  ResearchTask,
  ReviewRun,
  StrategySnapshot,
  StrategyVersion,
  TrustTier,
} from "@/lib/types";

type Row = Record<string, unknown>;

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function activityEventFrom(row: Row): ActivityEvent {
  return {
    id: String(row.id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    personId: row.person_id ? String(row.person_id) : null,
    organizationId: row.organization_id ? String(row.organization_id) : null,
    resumeId: row.resume_id ? String(row.resume_id) : null,
    searchTaskId: row.search_task_id ? String(row.search_task_id) : null,
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    experimentAssignmentId: row.experiment_assignment_id ? String(row.experiment_assignment_id) : null,
    eventType: String(row.event_type) as ActivityEventType,
    fromStatus: row.from_status ? String(row.from_status) : null,
    toStatus: row.to_status ? String(row.to_status) : null,
    reasonCode: String(row.reason_code),
    actorType: String(row.actor_type) as ActivityEvent["actorType"],
    actorId: String(row.actor_id),
    payload: json(String(row.payload_json || "{}")),
    occurredAt: String(row.occurred_at),
  };
}

function strategyFrom(row: Row): StrategyVersion {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    version: Number(row.version),
    status: String(row.status) as StrategyVersion["status"],
    parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
    sourceReviewRunId: row.source_review_run_id ? String(row.source_review_run_id) : null,
    strategy: json(String(row.strategy_json)),
    changeSummary: String(row.change_summary),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    activatedAt: row.activated_at ? String(row.activated_at) : null,
    supersededAt: row.superseded_at ? String(row.superseded_at) : null,
  };
}

function reviewFrom(row: Row): ReviewRun {
  return {
    id: String(row.id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    reviewType: String(row.review_type) as ReviewRun["reviewType"],
    status: String(row.status) as ReviewRun["status"],
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    metrics: json(String(row.metrics_json || "{}")),
    diagnosis: json(String(row.diagnosis_json || "[]")),
    proposedChanges: json(String(row.proposed_changes_json || "[]")),
    appliedChanges: json(String(row.applied_changes_json || "[]")),
    confidence: Number(row.confidence),
    modelName: String(row.model_name),
    estimatedCost: Number(row.estimated_cost),
    errorMessage: String(row.error_message || ""),
    triggeredBy: String(row.triggered_by),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function experimentFrom(row: Row): Experiment {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    name: String(row.name),
    dimension: String(row.dimension) as Experiment["dimension"],
    status: String(row.status) as Experiment["status"],
    primaryMetric: String(row.primary_metric),
    allocationPercent: Number(row.allocation_percent),
    minimumTasks: Number(row.minimum_tasks),
    minimumResults: Number(row.minimum_results),
    arms: json(String(row.arms_json || "[]")),
    result: json(String(row.result_json || "{}")),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

function sourceFrom(row: Row): IntelligenceSource {
  return {
    id: String(row.id),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    sourceType: String(row.source_type),
    trustTier: String(row.trust_tier) as TrustTier,
    title: String(row.title),
    url: String(row.url),
    publisher: String(row.publisher),
    publishedAt: row.published_at ? String(row.published_at) : null,
    quote: String(row.quote),
    contentHash: String(row.content_hash),
    collectedAt: String(row.collected_at),
  };
}

function claimFrom(row: Row, sourceIds: string[] = []): EvidenceClaim {
  return {
    id: String(row.id),
    organizationId: row.organization_id ? String(row.organization_id) : null,
    subjectType: String(row.subject_type) as EvidenceClaim["subjectType"],
    subjectId: String(row.subject_id),
    claimType: String(row.claim_type),
    classification: String(row.classification) as EvidenceClaim["classification"],
    statement: String(row.statement),
    value: json(String(row.value_json || "{}")),
    confidence: Number(row.confidence),
    status: String(row.status) as EvidenceClaim["status"],
    validFrom: row.valid_from ? String(row.valid_from) : null,
    validUntil: row.valid_until ? String(row.valid_until) : null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    sourceIds,
  };
}

function projectFrom(row: Row): IntelligenceProject {
  const claimRows = db.prepare(`SELECT ec.*, GROUP_CONCAT(cs.source_id) AS source_ids
    FROM evidence_claims ec LEFT JOIN project_claims pc ON pc.claim_id = ec.id
    LEFT JOIN claim_sources cs ON cs.claim_id = ec.id
    WHERE pc.project_id = ? GROUP BY ec.id ORDER BY ec.confidence DESC`).all(String(row.id)) as Row[];
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    organizationName: String(row.organization_name || ""),
    businessUnitId: row.business_unit_id ? String(row.business_unit_id) : null,
    name: String(row.name),
    projectType: String(row.project_type) as IntelligenceProject["projectType"],
    status: String(row.status),
    region: String(row.region),
    clientName: String(row.client_name),
    products: json(String(row.products_json || "[]")),
    skills: json(String(row.skills_json || "[]")),
    summary: String(row.summary),
    confidence: Number(row.confidence),
    talentDemandConfidence: Number(row.talent_demand_confidence),
    startedAt: row.started_at ? String(row.started_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    validUntil: row.valid_until ? String(row.valid_until) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    claims: claimRows.map((claim) => claimFrom(claim, String(claim.source_ids || "").split(",").filter(Boolean))),
  };
}

function researchTaskFrom(row: Row): ResearchTask {
  return {
    id: String(row.id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    organizationId: row.organization_id ? String(row.organization_id) : null,
    organizationName: row.organization_name ? String(row.organization_name) : null,
    topic: String(row.topic),
    triggerType: String(row.trigger_type),
    status: String(row.status) as ResearchTask["status"],
    resultSummary: String(row.result_summary || ""),
    errorMessage: String(row.error_message || ""),
    attempts: Number(row.attempts),
    modelName: String(row.model_name || ""),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export function recordActivityEvent(input: {
  campaignId?: string | null;
  personId?: string | null;
  organizationId?: string | null;
  resumeId?: string | null;
  searchTaskId?: string | null;
  strategyVersionId?: string | null;
  experimentAssignmentId?: string | null;
  eventType: ActivityEventType;
  fromStatus?: string | null;
  toStatus?: string | null;
  reasonCode: string;
  actorType: ActivityEvent["actorType"];
  actorId: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
  idempotencyKey?: string;
}) {
  const occurredAt = input.occurredAt || now();
  const idempotencyKey = input.idempotencyKey || createHash("sha256").update([
    input.eventType, input.campaignId, input.personId, input.resumeId, input.searchTaskId,
    input.fromStatus, input.toStatus, input.reasonCode, input.actorId, occurredAt,
  ].join("|")).digest("hex");
  const id = randomUUID();
  db.prepare(`INSERT OR IGNORE INTO activity_events
    (id, campaign_id, person_id, organization_id, resume_id, search_task_id, strategy_version_id, experiment_assignment_id,
      event_type, from_status, to_status, reason_code, actor_type, actor_id, payload_json, occurred_at, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.campaignId || null, input.personId || null, input.organizationId || null, input.resumeId || null,
      input.searchTaskId || null, input.strategyVersionId || null, input.experimentAssignmentId || null, input.eventType,
      input.fromStatus || null, input.toStatus || null, input.reasonCode, input.actorType, input.actorId,
      JSON.stringify(input.payload || {}), occurredAt, idempotencyKey);
  const row = db.prepare("SELECT * FROM activity_events WHERE idempotency_key = ?").get(idempotencyKey) as Row;
  return activityEventFrom(row);
}

export function listActivityEvents(input: { campaignId?: string; personId?: string; limit?: number } = {}) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.campaignId) { clauses.push("campaign_id = ?"); values.push(input.campaignId); }
  if (input.personId) { clauses.push("person_id = ?"); values.push(input.personId); }
  values.push(bounded(input.limit || 100, 1, 500));
  return (db.prepare(`SELECT * FROM activity_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY occurred_at DESC LIMIT ?`).all(...values) as Row[]).map(activityEventFrom);
}

export function attachCandidateOrigin(input: {
  campaignId: string;
  personId: string;
  resumeId?: string | null;
  searchTaskId?: string | null;
  organizationId?: string | null;
  strategyVersionId?: string | null;
  experimentAssignmentId?: string | null;
  keywords?: string[];
  sourceType: string;
}) {
  const dedupeKey = [input.campaignId, input.personId, input.resumeId || "", input.searchTaskId || ""].join("|");
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT OR IGNORE INTO candidate_origins
    (id, campaign_id, person_id, resume_id, search_task_id, organization_id, strategy_version_id, experiment_assignment_id, keyword_json, source_type, created_at, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.campaignId, input.personId, input.resumeId || null, input.searchTaskId || null, input.organizationId || null,
      input.strategyVersionId || null, input.experimentAssignmentId || null, JSON.stringify(input.keywords || []), input.sourceType, timestamp, dedupeKey);
  const row = db.prepare("SELECT * FROM candidate_origins WHERE dedupe_key = ?").get(dedupeKey) as Row;
  return {
    id: String(row.id), campaignId: String(row.campaign_id), personId: String(row.person_id),
    resumeId: row.resume_id ? String(row.resume_id) : null, searchTaskId: row.search_task_id ? String(row.search_task_id) : null,
    organizationId: row.organization_id ? String(row.organization_id) : null,
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    experimentAssignmentId: row.experiment_assignment_id ? String(row.experiment_assignment_id) : null,
    keywords: json<string[]>(String(row.keyword_json || "[]")), sourceType: String(row.source_type), createdAt: String(row.created_at),
  } satisfies CandidateOrigin;
}

export function listCandidateOrigins(personId: string, campaignId?: string) {
  const rows = campaignId
    ? db.prepare("SELECT * FROM candidate_origins WHERE person_id = ? AND campaign_id = ? ORDER BY created_at DESC").all(personId, campaignId)
    : db.prepare("SELECT * FROM candidate_origins WHERE person_id = ? ORDER BY created_at DESC").all(personId);
  return (rows as Row[]).map((row) => ({
    id: String(row.id), campaignId: String(row.campaign_id), personId: String(row.person_id),
    resumeId: row.resume_id ? String(row.resume_id) : null, searchTaskId: row.search_task_id ? String(row.search_task_id) : null,
    organizationId: row.organization_id ? String(row.organization_id) : null,
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    experimentAssignmentId: row.experiment_assignment_id ? String(row.experiment_assignment_id) : null,
    keywords: json<string[]>(String(row.keyword_json || "[]")), sourceType: String(row.source_type), createdAt: String(row.created_at),
  }));
}

function buildStrategySnapshot(campaignId: string): StrategySnapshot {
  const campaign = db.prepare("SELECT locations_json FROM campaigns WHERE id = ?").get(campaignId) as Row | undefined;
  if (!campaign) throw new Error("寻访战役不存在");
  const organizations = db.prepare(`SELECT o.id, o.name, COALESCE(lw.weight, 1) AS weight
    FROM campaign_organizations co JOIN organizations o ON o.id = co.organization_id
    LEFT JOIN learning_weights lw ON lw.campaign_id = co.campaign_id AND lw.signal_type = 'COMPANY' AND lw.signal_key = o.name
    WHERE co.campaign_id = ? AND co.status <> 'REJECTED' ORDER BY co.fit_score DESC LIMIT 50`).all(campaignId) as Row[];
  const keywords = db.prepare("SELECT signal_key, weight FROM learning_weights WHERE campaign_id = ? AND signal_type = 'KEYWORD' ORDER BY weight DESC, signal_key LIMIT 20").all(campaignId) as Row[];
  const autonomy = getAutonomySettings();
  return {
    targetOrganizations: organizations.map((row) => ({ id: String(row.id), name: String(row.name), weight: Number(row.weight) })),
    keywordGroups: keywords.map((row) => [String(row.signal_key)]),
    locations: json(String(campaign.locations_json || "[]")),
    searchTaskMinimumScore: getCandidateAutomationSettings().searchTaskMinimumScore,
    greetingPolicy: "只引用候选人明确履历事实，生成克制草稿，由 HR 人工审核发送。",
    explorationPercent: autonomy.explorationPercent,
    constraints: { maximumWeightDelta: autonomy.maximumWeightDelta, minimumWeight: 0.65, maximumWeight: 1.35 },
  };
}

export function listStrategyVersions(campaignId?: string) {
  const rows = campaignId
    ? db.prepare("SELECT * FROM strategy_versions WHERE campaign_id = ? ORDER BY version DESC").all(campaignId)
    : db.prepare("SELECT * FROM strategy_versions ORDER BY created_at DESC").all();
  return (rows as Row[]).map(strategyFrom);
}

export function getActiveStrategyVersion(campaignId: string) {
  const row = db.prepare("SELECT * FROM strategy_versions WHERE campaign_id = ? AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1").get(campaignId) as Row | undefined;
  return row ? strategyFrom(row) : null;
}

export function ensureActiveStrategyVersion(campaignId: string, createdBy = "AI 自主策略") {
  const active = getActiveStrategyVersion(campaignId);
  if (active) return active;
  return createStrategyVersion({ campaignId, strategy: buildStrategySnapshot(campaignId), changeSummary: "根据当前画像、公司权重和关键词建立首个可追溯策略版本。", createdBy, activate: true });
}

export function createStrategyVersion(input: {
  campaignId: string;
  strategy: StrategySnapshot;
  changeSummary: string;
  createdBy: string;
  sourceReviewRunId?: string | null;
  activate?: boolean;
}) {
  const current = getActiveStrategyVersion(input.campaignId);
  const versionRow = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM strategy_versions WHERE campaign_id = ?").get(input.campaignId) as Row;
  const id = randomUUID();
  const timestamp = now();
  const version = Number(versionRow.version) + 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (input.activate && current) db.prepare("UPDATE strategy_versions SET status = 'SUPERSEDED', superseded_at = ? WHERE id = ?").run(timestamp, current.id);
    db.prepare(`INSERT INTO strategy_versions
      (id, campaign_id, version, status, parent_version_id, source_review_run_id, strategy_json, change_summary, created_by, created_at, activated_at, superseded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(id, input.campaignId, version, input.activate ? "ACTIVE" : "DRAFT", current?.id || null, input.sourceReviewRunId || null,
        JSON.stringify(input.strategy), input.changeSummary.trim(), input.createdBy, timestamp, input.activate ? timestamp : null);
    if (input.activate) recordActivityEvent({ campaignId: input.campaignId, strategyVersionId: id, eventType: "STRATEGY_ACTIVATED", reasonCode: "STRATEGY_VERSION_CREATED", actorType: input.createdBy.startsWith("AI") ? "AI" : "USER", actorId: input.createdBy, payload: { version, parentVersionId: current?.id || null }, occurredAt: timestamp, idempotencyKey: `strategy-activated:${id}` });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return strategyFrom(db.prepare("SELECT * FROM strategy_versions WHERE id = ?").get(id) as Row);
}

export function activateStrategyVersion(id: string, actorId: string) {
  const row = db.prepare("SELECT * FROM strategy_versions WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("策略版本不存在");
  if (row.status === "ACTIVE") return strategyFrom(row);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE strategy_versions SET status = 'SUPERSEDED', superseded_at = ? WHERE campaign_id = ? AND status = 'ACTIVE'").run(timestamp, String(row.campaign_id));
    db.prepare("UPDATE strategy_versions SET status = 'ACTIVE', activated_at = ?, superseded_at = NULL WHERE id = ?").run(timestamp, id);
    recordActivityEvent({ campaignId: String(row.campaign_id), strategyVersionId: id, eventType: "STRATEGY_ACTIVATED", reasonCode: "MANUAL_ACTIVATION", actorType: "USER", actorId, occurredAt: timestamp, idempotencyKey: `strategy-activated:${id}:${timestamp}` });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return strategyFrom(db.prepare("SELECT * FROM strategy_versions WHERE id = ?").get(id) as Row);
}

export function rollbackActiveStrategy(campaignId: string, reason: string, actorId = "AI 自主复盘") {
  const active = getActiveStrategyVersion(campaignId);
  if (!active?.parentVersionId) return null;
  const parent = db.prepare("SELECT * FROM strategy_versions WHERE id = ?").get(active.parentVersionId) as Row | undefined;
  if (!parent) return null;
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE strategy_versions SET status = 'ROLLED_BACK', superseded_at = ? WHERE id = ?").run(timestamp, active.id);
    db.prepare("UPDATE strategy_versions SET status = 'ACTIVE', activated_at = ?, superseded_at = NULL WHERE id = ?").run(timestamp, String(parent.id));
    recordActivityEvent({ campaignId, strategyVersionId: active.id, eventType: "STRATEGY_ROLLED_BACK", reasonCode: "TWO_PERIOD_PERFORMANCE_DROP", actorType: "AI", actorId,
      payload: { rolledBackVersion: active.version, restoredVersion: Number(parent.version), reason }, occurredAt: timestamp, idempotencyKey: `strategy-rollback:${active.id}` });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { rolledBack: active, restored: strategyFrom(db.prepare("SELECT * FROM strategy_versions WHERE id = ?").get(String(parent.id)) as Row) };
}

export function listReviewRuns(campaignId?: string, limit = 100) {
  const rows = campaignId
    ? db.prepare("SELECT * FROM review_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT ?").all(campaignId, limit)
    : db.prepare("SELECT * FROM review_runs ORDER BY created_at DESC LIMIT ?").all(limit);
  return (rows as Row[]).map(reviewFrom);
}

function reviewMetrics(campaignId: string, start: string, end: string) {
  const feedback = db.prepare(`SELECT COUNT(*) AS tasks, COALESCE(SUM(f.result_count), 0) AS results,
      COALESCE(SUM(f.qualified_count), 0) AS qualified, COALESCE(SUM(f.effective_conversations), 0) AS conversations
    FROM search_task_feedback f JOIN search_tasks s ON s.id = f.task_id
    WHERE s.campaign_id = ? AND f.created_at >= ? AND f.created_at <= ?`).get(campaignId, start, end) as Row;
  const stages = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN event_type = 'INTERVIEW_RECORDED' THEN 1 ELSE 0 END), 0) AS interviews,
      COALESCE(SUM(CASE WHEN event_type = 'OFFER_RECORDED' THEN 1 ELSE 0 END), 0) AS offers,
      COALESCE(SUM(CASE WHEN event_type = 'HIRED_RECORDED' THEN 1 ELSE 0 END), 0) AS hires
    FROM activity_events WHERE campaign_id = ? AND occurred_at >= ? AND occurred_at <= ?`).get(campaignId, start, end) as Row;
  const results = Number(feedback.results || 0);
  const qualified = Number(feedback.qualified || 0);
  const conversations = Number(feedback.conversations || 0);
  return {
    completedTasks: Number(feedback.tasks || 0), searchResults: results, qualifiedCandidates: qualified, effectiveConversations: conversations,
    qualifiedRate: results ? qualified / results : 0, effectiveConversationRate: results ? conversations / results : 0,
    trackedEvents: Number(stages.total || 0), interviews: Number(stages.interviews || 0), offers: Number(stages.offers || 0), hires: Number(stages.hires || 0),
  };
}

function applyEligibleWeightChanges(campaignId: string, reviewRunId: string, start: string, end: string) {
  const settings = getAutonomySettings();
  const signals = db.prepare(`SELECT 'COMPANY' AS signal_type, s.company_name AS signal_key, COUNT(*) AS task_count,
      SUM(f.result_count) AS result_count, SUM(f.qualified_count) AS qualified_count, SUM(f.effective_conversations) AS conversation_count
    FROM search_task_feedback f JOIN search_tasks s ON s.id = f.task_id
    WHERE s.campaign_id = ? AND f.created_at >= ? AND f.created_at <= ? GROUP BY s.company_name
    UNION ALL
    SELECT lw.signal_type, lw.signal_key, COUNT(DISTINCT f.id), SUM(f.result_count), SUM(f.qualified_count), SUM(f.effective_conversations)
    FROM learning_weights lw JOIN search_tasks s ON s.campaign_id = lw.campaign_id
    JOIN search_task_feedback f ON f.task_id = s.id
    WHERE lw.campaign_id = ? AND lw.signal_type = 'KEYWORD' AND s.query_json LIKE '%' || lw.signal_key || '%' AND f.created_at >= ? AND f.created_at <= ?
    GROUP BY lw.signal_type, lw.signal_key`).all(campaignId, start, end, campaignId, start, end) as Row[];
  const applied: Array<Record<string, unknown>> = [];
  for (const signal of signals) {
    const taskCount = Number(signal.task_count || 0);
    const resultCount = Number(signal.result_count || 0);
    if (taskCount < settings.reviewMinimumTasks || resultCount < settings.reviewMinimumResults) continue;
    const qualified = Number(signal.qualified_count || 0);
    const conversations = Number(signal.conversation_count || 0);
    const score = resultCount ? bounded((qualified / resultCount) * 0.45 + (conversations / Math.max(qualified, 1)) * 0.55, 0, 1) : 0;
    const signalType = String(signal.signal_type);
    const signalKey = String(signal.signal_key);
    const row = db.prepare("SELECT * FROM learning_weights WHERE campaign_id = ? AND signal_type = ? AND signal_key = ?").get(campaignId, signalType, signalKey) as Row | undefined;
    const oldWeight = Number(row?.weight || 1);
    const proposed = bounded(0.65 + score * 0.7, 0.65, 1.35);
    const newWeight = bounded(oldWeight * 0.8 + proposed * 0.2, oldWeight - settings.maximumWeightDelta, oldWeight + settings.maximumWeightDelta);
    db.prepare(`INSERT INTO learning_weights (id, campaign_id, signal_type, signal_key, sample_count, positive_count, weight, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, signal_type, signal_key) DO UPDATE SET sample_count = excluded.sample_count, positive_count = excluded.positive_count, weight = excluded.weight, updated_at = excluded.updated_at`)
      .run(randomUUID(), campaignId, signalType, signalKey, taskCount, score * taskCount, newWeight, now());
    applied.push({ signalType, signalKey, oldWeight, newWeight: Number(newWeight.toFixed(3)), taskCount, resultCount, reviewRunId });
  }
  return applied;
}

export function runReview(input: { campaignId: string; reviewType: ReviewRun["reviewType"]; triggeredBy: string }) {
  const end = new Date();
  const days = input.reviewType === "DAILY" ? 1 : 28;
  const start = new Date(end.getTime() - days * 86_400_000);
  const id = randomUUID();
  const timestamp = now();
  const metrics = reviewMetrics(input.campaignId, start.toISOString(), end.toISOString());
  const settings = getAutonomySettings();
  const diagnosis: string[] = [];
  if (metrics.completedTasks < settings.reviewMinimumTasks) diagnosis.push(`完成任务 ${metrics.completedTasks} 个，尚未达到自动调整门槛 ${settings.reviewMinimumTasks} 个。`);
  if (metrics.searchResults < settings.reviewMinimumResults) diagnosis.push(`搜索结果 ${metrics.searchResults} 个，尚未达到自动调整门槛 ${settings.reviewMinimumResults} 个。`);
  if (metrics.searchResults && metrics.qualifiedRate < 0.1) diagnosis.push("高质量候选率偏低，应扩大职位同义词或调整目标公司组合。");
  if (metrics.qualifiedCandidates && metrics.effectiveConversations / metrics.qualifiedCandidates < 0.2) diagnosis.push("合格人选的有效沟通率偏低，应检查触达时机和招呼语证据引用。");
  if (!diagnosis.length) diagnosis.push("本周期漏斗与数据完整性未发现需要阻断的异常。");
  db.prepare(`INSERT INTO review_runs
    (id, campaign_id, review_type, status, window_start, window_end, metrics_json, diagnosis_json, proposed_changes_json, applied_changes_json,
      confidence, model_name, estimated_cost, error_message, triggered_by, created_at, completed_at)
    VALUES (?, ?, ?, 'RUNNING', ?, ?, ?, ?, '[]', '[]', 0, ?, 0, '', ?, ?, NULL)`)
    .run(id, input.campaignId, input.reviewType, start.toISOString(), end.toISOString(), JSON.stringify(metrics), JSON.stringify(diagnosis), getAiRuntimeConfig().model, input.triggeredBy, timestamp);
  const applied: Array<Record<string, unknown>> = [];
  let rolledBack = false;
  if (input.reviewType !== "DAILY" && settings.enabled && metrics.completedTasks >= settings.reviewMinimumTasks && metrics.searchResults >= settings.reviewMinimumResults) {
    const previousRows = db.prepare("SELECT metrics_json FROM review_runs WHERE campaign_id = ? AND review_type = 'WEEKLY' AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 2").all(input.campaignId) as Row[];
    const latest = previousRows[0] ? json<Record<string, number>>(String(previousRows[0].metrics_json)) : null;
    const baseline = previousRows[1] ? json<Record<string, number>>(String(previousRows[1].metrics_json)) : null;
    const currentRate = metrics.effectiveConversationRate;
    const latestRate = latest?.effectiveConversationRate || 0;
    const baselineRate = baseline?.effectiveConversationRate || 0;
    const canCompare = latest && baseline && Number(latest.completedTasks || 0) >= settings.reviewMinimumTasks && Number(latest.searchResults || 0) >= settings.reviewMinimumResults;
    const shouldRollback = Boolean(canCompare && baselineRate > 0 && latestRate < baselineRate * 0.8 && currentRate < baselineRate * 0.8);
    const rollback = shouldRollback ? rollbackActiveStrategy(input.campaignId, `连续两个完整周期的有效沟通率较基线下降超过 20%：${(baselineRate * 100).toFixed(1)}% → ${(latestRate * 100).toFixed(1)}% → ${(currentRate * 100).toFixed(1)}%`) : null;
    if (rollback) { rolledBack = true; applied.push({ type: "STRATEGY_ROLLBACK", fromVersion: rollback.rolledBack.version, toVersion: rollback.restored.version }); }
    if (!rollback) applied.push(...applyEligibleWeightChanges(input.campaignId, id, start.toISOString(), end.toISOString()));
    if (!rolledBack && applied.length) createStrategyVersion({ campaignId: input.campaignId, strategy: buildStrategySnapshot(input.campaignId), changeSummary: `复盘 ${metrics.completedTasks} 个任务、${metrics.searchResults} 个搜索结果后，小步更新 ${applied.length} 个搜索信号。`, createdBy: "AI 自主复盘", sourceReviewRunId: id, activate: true });
    const activeExperiment = db.prepare("SELECT 1 FROM experiments WHERE campaign_id = ? AND status IN ('DRAFT','RUNNING') LIMIT 1").get(input.campaignId);
    if (!rolledBack && !activeExperiment) {
      const keywordRows = db.prepare("SELECT signal_key FROM learning_weights WHERE campaign_id = ? AND signal_type = 'KEYWORD' ORDER BY weight DESC LIMIT 2").all(input.campaignId) as Row[];
      if (keywordRows.length === 2) {
        const experiment = createExperiment({ campaignId: input.campaignId, name: "职位词探索实验", dimension: "KEYWORD", arms: keywordRows.map((row, index) => ({ key: `keyword-${index + 1}`, label: String(row.signal_key), value: String(row.signal_key) })), createdBy: "AI 自主复盘" });
        updateExperimentStatus(experiment.id, "RUNNING");
      }
    }
  }
  const confidence = bounded(Math.min(metrics.completedTasks / settings.reviewMinimumTasks, metrics.searchResults / settings.reviewMinimumResults), 0, 1);
  db.prepare("UPDATE review_runs SET status = 'SUCCEEDED', applied_changes_json = ?, confidence = ?, completed_at = ? WHERE id = ?")
    .run(JSON.stringify(applied), confidence, now(), id);
  return reviewFrom(db.prepare("SELECT * FROM review_runs WHERE id = ?").get(id) as Row);
}

export function ensureScheduledReviews() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date());
  const campaigns = db.prepare("SELECT id FROM campaigns WHERE status = 'ACTIVE'").all() as Row[];
  for (const campaign of campaigns) {
    const dailyKey = `scheduled-review:${campaign.id}:DAILY:${today}`;
    if (!db.prepare("SELECT 1 FROM activity_events WHERE idempotency_key = ?").get(dailyKey)) {
      runReview({ campaignId: String(campaign.id), reviewType: "DAILY", triggeredBy: "系统定时复盘" });
      recordActivityEvent({ campaignId: String(campaign.id), eventType: "REVIEW_COMPLETED", reasonCode: "DAILY_REVIEW_COMPLETED", actorType: "SYSTEM", actorId: "review-scheduler", idempotencyKey: dailyKey });
    }
    if (day === "Mon") {
      const weeklyKey = `scheduled-review:${campaign.id}:WEEKLY:${today}`;
      if (!db.prepare("SELECT 1 FROM activity_events WHERE idempotency_key = ?").get(weeklyKey)) {
        runReview({ campaignId: String(campaign.id), reviewType: "WEEKLY", triggeredBy: "系统每周复盘" });
        recordActivityEvent({ campaignId: String(campaign.id), eventType: "REVIEW_COMPLETED", reasonCode: "WEEKLY_REVIEW_COMPLETED", actorType: "SYSTEM", actorId: "review-scheduler", idempotencyKey: weeklyKey });
      }
    }
  }
}

export function listExperiments(campaignId?: string) {
  const rows = campaignId
    ? db.prepare("SELECT * FROM experiments WHERE campaign_id = ? ORDER BY created_at DESC").all(campaignId)
    : db.prepare("SELECT * FROM experiments ORDER BY created_at DESC").all();
  return (rows as Row[]).map(experimentFrom);
}

export function createExperiment(input: {
  campaignId: string;
  name: string;
  dimension: Experiment["dimension"];
  arms: Experiment["arms"];
  createdBy: string;
}) {
  if (input.arms.length < 2 || input.arms.length > 4) throw new Error("实验需要 2 至 4 个互斥方案");
  const settings = getAutonomySettings();
  const strategy = ensureActiveStrategyVersion(input.campaignId);
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`INSERT INTO experiments
    (id, campaign_id, strategy_version_id, name, dimension, status, primary_metric, allocation_percent, minimum_tasks, minimum_results, arms_json, result_json, created_by, created_at, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, 'DRAFT', 'EFFECTIVE_CONVERSATION_RATE', ?, ?, ?, ?, '{}', ?, ?, NULL, NULL)`)
    .run(id, input.campaignId, strategy.id, input.name.trim(), input.dimension, settings.explorationPercent, settings.reviewMinimumTasks, settings.reviewMinimumResults, JSON.stringify(input.arms), input.createdBy, timestamp);
  return experimentFrom(db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as Row);
}

export function updateExperimentStatus(id: string, status: Experiment["status"]) {
  const timestamp = now();
  db.prepare(`UPDATE experiments SET status = ?, started_at = CASE WHEN ? = 'RUNNING' AND started_at IS NULL THEN ? ELSE started_at END,
    completed_at = CASE WHEN ? IN ('COMPLETED','CANCELLED') THEN ? ELSE completed_at END WHERE id = ?`)
    .run(status, status, timestamp, status, timestamp, id);
  const row = db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new Error("实验不存在");
  return experimentFrom(row);
}

export function assignExperimentToSearchTask(campaignId: string, searchTaskId: string) {
  const row = db.prepare("SELECT * FROM experiments WHERE campaign_id = ? AND status = 'RUNNING' ORDER BY started_at, created_at LIMIT 1").get(campaignId) as Row | undefined;
  if (!row) return null;
  const experiment = experimentFrom(row);
  const bucket = Number.parseInt(createHash("sha256").update(`${experiment.id}:${searchTaskId}`).digest("hex").slice(0, 8), 16) % 100;
  if (bucket >= experiment.allocationPercent) return null;
  const arm = experiment.arms[bucket % experiment.arms.length];
  const id = randomUUID();
  db.prepare("INSERT INTO experiment_assignments (id, experiment_id, arm_key, search_task_id, person_id, assigned_at) VALUES (?, ?, ?, ?, NULL, ?)")
    .run(id, experiment.id, arm.key, searchTaskId, now());
  db.prepare("UPDATE search_tasks SET experiment_assignment_id = ? WHERE id = ?").run(id, searchTaskId);
  return { id, experiment, arm };
}

export function createResearchTask(input: { campaignId?: string | null; organizationId: string; topic: string; triggerType: string; createdBy: string }) {
  const settings = getAutonomySettings();
  const cooldown = new Date(Date.now() - settings.researchCooldownDays * 86_400_000).toISOString();
  const recent = db.prepare(`SELECT * FROM research_tasks WHERE organization_id = ? AND topic = ? AND created_at >= ?
    AND status IN ('QUEUED','RUNNING','SUCCEEDED') ORDER BY created_at DESC LIMIT 1`).get(input.organizationId, input.topic.trim(), cooldown) as Row | undefined;
  if (recent) return researchTaskFrom({ ...recent, organization_name: (db.prepare("SELECT name FROM organizations WHERE id = ?").get(input.organizationId) as Row)?.name });
  const dayStart = `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())}T00:00:00.000Z`;
  const todayCount = Number((db.prepare("SELECT COUNT(*) AS count FROM research_tasks WHERE created_at >= ?").get(dayStart) as Row).count);
  if (todayCount >= settings.researchDailyLimit) throw new Error(`今日研究任务已达到上限 ${settings.researchDailyLimit}`);
  const timestamp = now();
  const dedupeKey = createHash("sha256").update(`${input.organizationId}|${input.topic.trim()}|${timestamp.slice(0, 10)}`).digest("hex");
  const id = randomUUID();
  db.prepare(`INSERT OR IGNORE INTO research_tasks
    (id, campaign_id, organization_id, topic, trigger_type, status, result_summary, error_message, attempts, model_name, created_by, created_at, started_at, completed_at, dedupe_key)
    VALUES (?, ?, ?, ?, ?, 'QUEUED', '', '', 0, '', ?, ?, NULL, NULL, ?)`)
    .run(id, input.campaignId || null, input.organizationId, input.topic.trim(), input.triggerType, input.createdBy, timestamp, dedupeKey);
  const row = db.prepare(`SELECT rt.*, o.name AS organization_name FROM research_tasks rt LEFT JOIN organizations o ON o.id = rt.organization_id WHERE rt.dedupe_key = ?`).get(dedupeKey) as Row;
  return researchTaskFrom(row);
}

export function listResearchTasks(input: { campaignId?: string; status?: string; limit?: number } = {}) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (input.campaignId) { clauses.push("rt.campaign_id = ?"); values.push(input.campaignId); }
  if (input.status) { clauses.push("rt.status = ?"); values.push(input.status); }
  values.push(input.limit || 100);
  return (db.prepare(`SELECT rt.*, o.name AS organization_name FROM research_tasks rt LEFT JOIN organizations o ON o.id = rt.organization_id
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY rt.created_at DESC LIMIT ?`).all(...values) as Row[]).map(researchTaskFrom);
}

export function claimNextResearchTask() {
  const settings = getAutonomySettings();
  if (!settings.enabled || !settings.webResearchEnabled) return null;
  const running = Number((db.prepare("SELECT COUNT(*) AS count FROM research_tasks WHERE status = 'RUNNING'").get() as Row).count);
  if (running >= settings.researchConcurrency) return null;
  const row = db.prepare("SELECT * FROM research_tasks WHERE status = 'QUEUED' ORDER BY created_at LIMIT 1").get() as Row | undefined;
  if (!row) return null;
  const runtime = getAiRuntimeConfig();
  if (runtime.apiStyle !== "responses" || settings.webSearchCapability !== "AVAILABLE") {
    db.prepare("UPDATE research_tasks SET status = 'BLOCKED_CONFIGURATION', error_message = ?, completed_at = ? WHERE id = ?")
      .run("当前 AI Provider 未通过 Responses API web_search 能力检测", now(), String(row.id));
    return null;
  }
  const claimed = db.prepare("UPDATE research_tasks SET status = 'RUNNING', attempts = attempts + 1, model_name = ?, started_at = ?, error_message = '' WHERE id = ? AND status = 'QUEUED'")
    .run(runtime.model, now(), String(row.id));
  return claimed.changes ? researchTaskFrom({ ...row, status: "RUNNING", model_name: runtime.model, attempts: Number(row.attempts) + 1 }) : null;
}

export async function processNextResearchTask() {
  const task = claimNextResearchTask();
  if (!task || !task.organizationId) return null;
  try {
    const organization = db.prepare("SELECT name, description FROM organizations WHERE id = ?").get(task.organizationId) as Row | undefined;
    if (!organization) throw new Error("研究任务关联公司不存在");
    const result = await researchOrganizationWithWebSearch({
      organizationName: String(organization.name),
      topic: task.topic,
      context: String(organization.description || ""),
    });
    persistResearchResult({ taskId: task.id, ...result });
    return listResearchTasks({ limit: 1 }).find((item) => item.id === task.id) || task;
  } catch (error) {
    failResearchTask(task.id, error);
    return null;
  }
}

function defaultValidity(claimType: string) {
  const settings = getAutonomySettings();
  const days = /hiring|recruit/i.test(claimType) ? settings.hiringSignalFreshnessDays : /project/i.test(claimType) ? settings.projectFreshnessDays : settings.currentBusinessFreshnessDays;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function persistResearchResult(input: {
  taskId: string;
  summary: string;
  sources: Array<{ sourceType: string; trustTier: TrustTier; title: string; url: string; publisher: string; publishedAt?: string | null; quote: string }>;
  claims: Array<{ claimType: string; classification: EvidenceClaim["classification"]; statement: string; value?: Record<string, unknown>; confidence: number; sourceUrls: string[]; validFrom?: string | null; validUntil?: string | null }>;
  businessUnits: Array<{ name: string; unitType: string; description: string; status: string; confidence: number; sourceUrls: string[]; validFrom?: string | null; validUntil?: string | null }>;
  projects: Array<{ name: string; businessUnitName?: string | null; projectType: IntelligenceProject["projectType"]; status: string; region: string; clientName?: string; products?: string[]; skills?: string[]; summary: string; confidence: number; talentDemandConfidence: number; sourceUrls: string[]; startedAt?: string | null; endedAt?: string | null }>;
  events: Array<{ eventType: string; title: string; summary: string; classification: EvidenceClaim["classification"]; confidence: number; sourceUrls: string[]; occurredAt?: string | null }>;
}) {
  const task = db.prepare("SELECT * FROM research_tasks WHERE id = ?").get(input.taskId) as Row | undefined;
  if (!task) throw new Error("研究任务不存在");
  const organizationId = String(task.organization_id);
  const settings = getAutonomySettings();
  const timestamp = now();
  const sourceIdsByUrl = new Map<string, string>();
  const disputedClaimTypes = new Set<string>();
  const strategy = task.campaign_id ? ensureActiveStrategyVersion(String(task.campaign_id)) : null;
  const organization = db.prepare("SELECT name FROM organizations WHERE id = ?").get(organizationId) as Row | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const source of input.sources) {
      let url: URL;
      try { url = new URL(source.url); } catch { continue; }
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const contentHash = createHash("sha256").update(`${source.url}|${source.quote}`).digest("hex");
      const id = randomUUID();
      db.prepare(`INSERT OR IGNORE INTO intelligence_sources
        (id, organization_id, source_type, trust_tier, title, url, publisher, published_at, quote, content_hash, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, organizationId, source.sourceType, source.trustTier, source.title, source.url, source.publisher, source.publishedAt || null, source.quote.slice(0, 1200), contentHash, timestamp);
      const stored = db.prepare("SELECT id FROM intelligence_sources WHERE url = ? AND content_hash = ?").get(source.url, contentHash) as Row;
      sourceIdsByUrl.set(source.url, String(stored.id));
    }
    const evidenceFor = (urls: string[]) => {
      const sourceIds = [...new Set(urls.map((url) => sourceIdsByUrl.get(url)).filter((value): value is string => Boolean(value)))];
      const sourceRows = sourceIds.length
        ? db.prepare(`SELECT trust_tier FROM intelligence_sources WHERE id IN (${sourceIds.map(() => "?").join(",")})`).all(...sourceIds) as Row[]
        : [];
      const hasOfficialSource = sourceRows.some((source) => source.trust_tier === "OFFICIAL");
      const hasStrongSource = sourceRows.some((source) => ["OFFICIAL", "REPUTABLE"].includes(String(source.trust_tier)));
      return { sourceIds, canPromote: hasStrongSource && (hasOfficialSource || sourceIds.length >= 2) };
    };
    for (const claim of input.claims) {
      const evidence = evidenceFor(claim.sourceUrls);
      const sourceIds = evidence.sourceIds;
      const canPromote = claim.classification === "FACT" && claim.confidence >= settings.claimPromotionMinimumConfidence && evidence.canPromote;
      const status = claim.classification === "DISPUTED" ? "DISPUTED" : canPromote ? "PROMOTED" : "CANDIDATE";
      if (claim.classification === "DISPUTED") {
        disputedClaimTypes.add(claim.claimType);
        db.prepare(`UPDATE evidence_claims SET status = 'DISPUTED', conflict_group_key = ?, last_seen_at = ?
          WHERE organization_id = ? AND subject_type = 'ORGANIZATION' AND subject_id = ? AND claim_type = ? AND status = 'PROMOTED'`)
          .run(`${organizationId}:${claim.claimType}`, timestamp, organizationId, organizationId, claim.claimType);
      }
      const id = randomUUID();
      db.prepare(`INSERT INTO evidence_claims
        (id, organization_id, subject_type, subject_id, claim_type, classification, statement, value_json, confidence, status, valid_from, valid_until, first_seen_at, last_seen_at, conflict_group_key)
        VALUES (?, ?, 'ORGANIZATION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(subject_type, subject_id, claim_type, statement) DO UPDATE SET confidence = MAX(evidence_claims.confidence, excluded.confidence),
          status = CASE WHEN evidence_claims.status = 'DISPUTED' THEN evidence_claims.status ELSE excluded.status END,
          last_seen_at = excluded.last_seen_at, valid_until = excluded.valid_until`)
        .run(id, organizationId, organizationId, claim.claimType, claim.classification, claim.statement, JSON.stringify(claim.value || {}), bounded(Math.round(claim.confidence), 0, 100), status,
          claim.validFrom || null, claim.validUntil || (claim.classification === "FACT" ? defaultValidity(claim.claimType) : null), timestamp, timestamp, claim.classification === "DISPUTED" ? `${organizationId}:${claim.claimType}` : "");
      const stored = db.prepare("SELECT id FROM evidence_claims WHERE subject_type = 'ORGANIZATION' AND subject_id = ? AND claim_type = ? AND statement = ?").get(organizationId, claim.claimType, claim.statement) as Row;
      for (const sourceId of sourceIds) db.prepare("INSERT OR IGNORE INTO claim_sources (claim_id, source_id) VALUES (?, ?)").run(String(stored.id), sourceId);
    }
    for (const unit of input.businessUnits) {
      const evidence = evidenceFor(unit.sourceUrls);
      if (!evidence.sourceIds.length) continue;
      db.prepare(`INSERT INTO business_units
        (id, organization_id, name, unit_type, description, status, confidence, valid_from, valid_until, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, name) DO UPDATE SET unit_type = excluded.unit_type, description = excluded.description,
          status = excluded.status, confidence = MAX(business_units.confidence, excluded.confidence),
          valid_from = COALESCE(excluded.valid_from, business_units.valid_from), valid_until = excluded.valid_until, updated_at = excluded.updated_at`)
        .run(randomUUID(), organizationId, unit.name.trim(), unit.unitType, unit.description, unit.status,
          bounded(Math.round(unit.confidence), 0, 100), unit.validFrom || null, unit.validUntil || defaultValidity("business"), timestamp, timestamp);
      const storedUnit = db.prepare("SELECT id FROM business_units WHERE organization_id = ? AND name = ?").get(organizationId, unit.name.trim()) as Row;
      const unitClaimId = randomUUID();
      const unitClaimStatus = unit.confidence >= settings.claimPromotionMinimumConfidence && evidence.canPromote ? "PROMOTED" : "CANDIDATE";
      db.prepare(`INSERT INTO evidence_claims
        (id, organization_id, subject_type, subject_id, claim_type, classification, statement, value_json, confidence, status, valid_from, valid_until, first_seen_at, last_seen_at, conflict_group_key)
        VALUES (?, ?, 'BUSINESS_UNIT', ?, 'business_unit_profile', 'FACT', ?, ?, ?, ?, ?, ?, ?, ?, '')
        ON CONFLICT(subject_type, subject_id, claim_type, statement) DO UPDATE SET confidence = MAX(evidence_claims.confidence, excluded.confidence),
          status = CASE WHEN evidence_claims.status = 'DISPUTED' THEN evidence_claims.status ELSE excluded.status END,
          last_seen_at = excluded.last_seen_at, valid_until = excluded.valid_until`)
        .run(unitClaimId, organizationId, String(storedUnit.id), unit.description, JSON.stringify({ name: unit.name, unitType: unit.unitType, status: unit.status }),
          bounded(Math.round(unit.confidence), 0, 100), unitClaimStatus, unit.validFrom || null, unit.validUntil || defaultValidity("business"), timestamp, timestamp);
      const storedUnitClaim = db.prepare("SELECT id FROM evidence_claims WHERE subject_type = 'BUSINESS_UNIT' AND subject_id = ? AND claim_type = 'business_unit_profile' AND statement = ?")
        .get(String(storedUnit.id), unit.description) as Row;
      for (const sourceId of evidence.sourceIds) db.prepare("INSERT OR IGNORE INTO claim_sources (claim_id, source_id) VALUES (?, ?)").run(String(storedUnitClaim.id), sourceId);
    }
    for (const project of input.projects) {
      const projectEvidence = evidenceFor(project.sourceUrls);
      if (!projectEvidence.sourceIds.length) continue;
      const id = randomUUID();
      const validUntil = new Date(Date.now() + settings.projectFreshnessDays * 86_400_000).toISOString();
      const businessUnit = project.businessUnitName
        ? db.prepare("SELECT id FROM business_units WHERE organization_id = ? AND name = ?").get(organizationId, project.businessUnitName) as Row | undefined
        : undefined;
      db.prepare(`INSERT INTO projects
        (id, organization_id, business_unit_id, name, project_type, status, region, client_name, products_json, skills_json, summary, confidence, talent_demand_confidence, started_at, ended_at, valid_until, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, name, project_type) DO UPDATE SET business_unit_id = COALESCE(excluded.business_unit_id, projects.business_unit_id), status = excluded.status, region = excluded.region, client_name = excluded.client_name,
          products_json = excluded.products_json, skills_json = excluded.skills_json, summary = excluded.summary,
          confidence = MAX(projects.confidence, excluded.confidence), talent_demand_confidence = MAX(projects.talent_demand_confidence, excluded.talent_demand_confidence),
          started_at = COALESCE(excluded.started_at, projects.started_at), ended_at = COALESCE(excluded.ended_at, projects.ended_at), valid_until = excluded.valid_until, updated_at = excluded.updated_at`)
        .run(id, organizationId, businessUnit ? String(businessUnit.id) : null, project.name, project.projectType, project.status, project.region, project.clientName || "", JSON.stringify(project.products || []), JSON.stringify(project.skills || []), project.summary,
          bounded(Math.round(project.confidence), 0, 100), bounded(Math.round(project.talentDemandConfidence), 0, 100), project.startedAt || null, project.endedAt || null, validUntil, timestamp, timestamp);
      const storedProject = db.prepare("SELECT id FROM projects WHERE organization_id = ? AND name = ? AND project_type = ?").get(organizationId, project.name, project.projectType) as Row;
      const projectClaimStatus = project.confidence >= settings.claimPromotionMinimumConfidence && projectEvidence.canPromote ? "PROMOTED" : "CANDIDATE";
      db.prepare(`INSERT INTO evidence_claims
        (id, organization_id, subject_type, subject_id, claim_type, classification, statement, value_json, confidence, status, valid_from, valid_until, first_seen_at, last_seen_at, conflict_group_key)
        VALUES (?, ?, 'PROJECT', ?, 'project_fact', 'FACT', ?, ?, ?, ?, ?, ?, ?, ?, '')
        ON CONFLICT(subject_type, subject_id, claim_type, statement) DO UPDATE SET confidence = MAX(evidence_claims.confidence, excluded.confidence),
          status = CASE WHEN evidence_claims.status = 'DISPUTED' THEN evidence_claims.status ELSE excluded.status END,
          last_seen_at = excluded.last_seen_at, valid_until = excluded.valid_until`)
        .run(randomUUID(), organizationId, String(storedProject.id), project.summary,
          JSON.stringify({ name: project.name, projectType: project.projectType, status: project.status, region: project.region }),
          bounded(Math.round(project.confidence), 0, 100), projectClaimStatus, project.startedAt || null, validUntil, timestamp, timestamp);
      const storedProjectClaim = db.prepare("SELECT id FROM evidence_claims WHERE subject_type = 'PROJECT' AND subject_id = ? AND claim_type = 'project_fact' AND statement = ?")
        .get(String(storedProject.id), project.summary) as Row;
      for (const sourceId of projectEvidence.sourceIds) db.prepare("INSERT OR IGNORE INTO claim_sources (claim_id, source_id) VALUES (?, ?)").run(String(storedProjectClaim.id), sourceId);
      db.prepare("INSERT OR IGNORE INTO project_claims (project_id, claim_id) VALUES (?, ?)").run(String(storedProject.id), String(storedProjectClaim.id));
      const projectClaims = db.prepare(`SELECT id FROM evidence_claims WHERE organization_id = ?
        AND (LOWER(claim_type) LIKE '%project%' OR statement LIKE ?)`)
        .all(organizationId, `%${project.name}%`) as Row[];
      for (const claim of projectClaims) db.prepare("INSERT OR IGNORE INTO project_claims (project_id, claim_id) VALUES (?, ?)").run(String(storedProject.id), String(claim.id));
      if (task.campaign_id && strategy && projectClaimStatus === "PROMOTED" && project.confidence >= settings.projectSearchMinimumConfidence && project.talentDemandConfidence >= settings.talentDemandMinimumConfidence) {
        const keywords = [...new Set((project.skills || []).map((value) => [...value.trim()].slice(0, 16).join("")).filter(Boolean))].slice(0, 4);
        const period = timestamp.slice(0, 7);
        const searchTaskId = randomUUID();
        const dedupeKey = createHash("sha256").update(`${task.campaign_id}|${organizationId}|${project.name}|${period}|project-v1`).digest("hex");
        const result = db.prepare(`INSERT OR IGNORE INTO search_tasks
          (id, campaign_id, run_id, task_type, title, company_name, query_json, reason_json, priority, dedupe_key, status, claimed_by, expires_at, created_at, completed_at, strategy_version_id, experiment_assignment_id)
          VALUES (?, ?, NULL, 'PROJECT_INTELLIGENCE_SEARCH', ?, ?, ?, ?, ?, ?, 'NEW', NULL, ?, ?, NULL, ?, NULL)`)
          .run(searchTaskId, String(task.campaign_id), `根据 ${project.name} 寻找相关人才`, String(organization?.name || ""),
            JSON.stringify({ keywords, locations: project.region ? [project.region] : strategy.strategy.locations, experience: "使用 BOSS 筛选项单独设置", instructions: ["先使用公司名与一个宽泛职位词搜索", "结果少时仅保留职位词"] }),
            JSON.stringify({ summary: project.summary, evidence: [`公开项目事实置信度 ${project.confidence}%，人才需求推断 ${project.talentDemandConfidence}%`], expectedCandidate: keywords.join("、") }),
            bounded(Math.round(project.confidence * 0.6 + project.talentDemandConfidence * 0.4), 1, 100), dedupeKey,
            new Date(Date.now() + 14 * 86_400_000).toISOString(), timestamp, strategy.id);
        if (result.changes) recordActivityEvent({ campaignId: String(task.campaign_id), organizationId, searchTaskId, strategyVersionId: strategy.id,
          eventType: "SEARCH_TASK_CREATED", reasonCode: "PROJECT_TALENT_HYPOTHESIS", actorType: "AI", actorId: String(task.model_name || "AI"),
          payload: { projectName: project.name, projectConfidence: project.confidence, talentDemandConfidence: project.talentDemandConfidence, keywords },
          occurredAt: timestamp, idempotencyKey: `search-task-created:${searchTaskId}` });
      }
    }
    for (const event of input.events) {
      const eventEvidence = evidenceFor(event.sourceUrls);
      if (!eventEvidence.sourceIds.length) continue;
      const eventId = randomUUID();
      db.prepare(`INSERT INTO organization_events (id, organization_id, event_type, title, summary, classification, confidence, occurred_at, valid_until, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, organizationId, event.eventType, event.title, event.summary, event.classification, bounded(Math.round(event.confidence), 0, 100), event.occurredAt || null, defaultValidity(event.eventType), timestamp);
      const eventClaimStatus = event.classification === "DISPUTED" ? "DISPUTED"
        : event.classification === "FACT" && event.confidence >= settings.claimPromotionMinimumConfidence && eventEvidence.canPromote ? "PROMOTED" : "CANDIDATE";
      db.prepare(`INSERT INTO evidence_claims
        (id, organization_id, subject_type, subject_id, claim_type, classification, statement, value_json, confidence, status, valid_from, valid_until, first_seen_at, last_seen_at, conflict_group_key)
        VALUES (?, ?, 'ORGANIZATION_EVENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), organizationId, eventId, event.eventType, event.classification, event.summary, JSON.stringify({ title: event.title }),
          bounded(Math.round(event.confidence), 0, 100), eventClaimStatus, event.occurredAt || null, defaultValidity(event.eventType), timestamp, timestamp,
          event.classification === "DISPUTED" ? `${organizationId}:${event.eventType}` : "");
      const storedEventClaim = db.prepare("SELECT id FROM evidence_claims WHERE subject_type = 'ORGANIZATION_EVENT' AND subject_id = ? AND claim_type = ? AND statement = ?")
        .get(eventId, event.eventType, event.summary) as Row;
      for (const sourceId of eventEvidence.sourceIds) db.prepare("INSERT OR IGNORE INTO claim_sources (claim_id, source_id) VALUES (?, ?)").run(String(storedEventClaim.id), sourceId);
    }
    db.prepare("UPDATE research_tasks SET status = 'SUCCEEDED', result_summary = ?, error_message = '', completed_at = ? WHERE id = ?")
      .run(input.summary, timestamp, input.taskId);
    recordActivityEvent({ campaignId: task.campaign_id ? String(task.campaign_id) : null, organizationId, eventType: "RESEARCH_COMPLETED", reasonCode: "PUBLIC_WEB_RESEARCH", actorType: "AI", actorId: String(task.model_name || "AI"), payload: { taskId: input.taskId, sourceCount: sourceIdsByUrl.size, claimCount: input.claims.length, projectCount: input.projects.length }, occurredAt: timestamp, idempotencyKey: `research-completed:${input.taskId}` });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  for (const claimType of disputedClaimTypes) {
    try {
      createResearchTask({ campaignId: task.campaign_id ? String(task.campaign_id) : null, organizationId, topic: `核实冲突情报：${claimType}`, triggerType: "EVIDENCE_CONFLICT", createdBy: "AI 情报治理" });
    } catch {
      recordActivityEvent({ campaignId: task.campaign_id ? String(task.campaign_id) : null, organizationId, eventType: "RESEARCH_BLOCKED",
        reasonCode: "EVIDENCE_CONFLICT_RESEARCH_DEFERRED", actorType: "SYSTEM", actorId: "intelligence-governance",
        payload: { claimType }, idempotencyKey: `conflict-research-deferred:${organizationId}:${claimType}:${timestamp.slice(0, 10)}` });
    }
  }
}

export function failResearchTask(taskId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "研究任务失败";
  db.prepare("UPDATE research_tasks SET status = 'FAILED', error_message = ?, completed_at = ? WHERE id = ?").run(message.slice(0, 1000), now(), taskId);
}

export function listIntelligenceSources(organizationId?: string) {
  const rows = organizationId
    ? db.prepare("SELECT * FROM intelligence_sources WHERE organization_id = ? ORDER BY collected_at DESC").all(organizationId)
    : db.prepare("SELECT * FROM intelligence_sources ORDER BY collected_at DESC LIMIT 500").all();
  return (rows as Row[]).map(sourceFrom);
}

export function listEvidenceClaims(organizationId?: string) {
  const rows = organizationId
    ? db.prepare(`SELECT ec.*, GROUP_CONCAT(cs.source_id) AS source_ids FROM evidence_claims ec LEFT JOIN claim_sources cs ON cs.claim_id = ec.id
      WHERE ec.organization_id = ? GROUP BY ec.id ORDER BY ec.status, ec.confidence DESC`).all(organizationId)
    : db.prepare(`SELECT ec.*, GROUP_CONCAT(cs.source_id) AS source_ids FROM evidence_claims ec LEFT JOIN claim_sources cs ON cs.claim_id = ec.id
      GROUP BY ec.id ORDER BY ec.last_seen_at DESC LIMIT 500`).all();
  return (rows as Row[]).map((row) => claimFrom(row, String(row.source_ids || "").split(",").filter(Boolean)));
}

export function markStaleClaims() {
  return db.prepare("UPDATE evidence_claims SET status = 'STALE' WHERE status = 'PROMOTED' AND valid_until IS NOT NULL AND valid_until < ?").run(now()).changes;
}

export function listProjects(organizationId?: string) {
  const rows = organizationId
    ? db.prepare("SELECT p.*, o.name AS organization_name FROM projects p JOIN organizations o ON o.id = p.organization_id WHERE p.organization_id = ? ORDER BY p.updated_at DESC").all(organizationId)
    : db.prepare("SELECT p.*, o.name AS organization_name FROM projects p JOIN organizations o ON o.id = p.organization_id ORDER BY p.updated_at DESC").all();
  return (rows as Row[]).map(projectFrom);
}

export function listOrganizationEvents(organizationId?: string) {
  const rows = organizationId
    ? db.prepare("SELECT * FROM organization_events WHERE organization_id = ? ORDER BY COALESCE(occurred_at, created_at) DESC").all(organizationId)
    : db.prepare("SELECT * FROM organization_events ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT 500").all();
  return (rows as Row[]).map((row) => ({
    id: String(row.id), organizationId: String(row.organization_id), eventType: String(row.event_type), title: String(row.title), summary: String(row.summary),
    classification: String(row.classification) as OrganizationEvent["classification"], confidence: Number(row.confidence), occurredAt: row.occurred_at ? String(row.occurred_at) : null,
    validUntil: row.valid_until ? String(row.valid_until) : null, createdAt: String(row.created_at),
  }));
}

export function autonomyOverview(campaignId?: string) {
  const filter = campaignId ? "WHERE campaign_id = ?" : "";
  const values = campaignId ? [campaignId] : [];
  const count = (sql: string, args: Array<string | number | null> = []) => Number((db.prepare(sql).get(...args) as Row).count);
  const recentReview = campaignId ? listReviewRuns(campaignId, 1)[0] || null : listReviewRuns(undefined, 1)[0] || null;
  return {
    trackedEvents: count(`SELECT COUNT(*) AS count FROM activity_events ${filter}`, values),
    activeStrategies: count(`SELECT COUNT(*) AS count FROM strategy_versions ${filter ? `${filter} AND` : "WHERE"} status = 'ACTIVE'`, values),
    runningExperiments: count(`SELECT COUNT(*) AS count FROM experiments ${filter ? `${filter} AND` : "WHERE"} status = 'RUNNING'`, values),
    pendingResearch: count(`SELECT COUNT(*) AS count FROM research_tasks ${filter ? `${filter} AND` : "WHERE"} status IN ('QUEUED','RUNNING','BLOCKED_CONFIGURATION')`, values),
    promotedClaims: count("SELECT COUNT(*) AS count FROM evidence_claims WHERE status = 'PROMOTED'"),
    disputedClaims: count("SELECT COUNT(*) AS count FROM evidence_claims WHERE status = 'DISPUTED'"),
    staleClaims: count("SELECT COUNT(*) AS count FROM evidence_claims WHERE status = 'STALE'"),
    projects: count("SELECT COUNT(*) AS count FROM projects"),
    recentReview,
  };
}
