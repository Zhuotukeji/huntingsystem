import { randomUUID } from "node:crypto";
import { db, json, now } from "@/lib/db";

type Row = Record<string, string | number | null>;

export const ANALYTICS_WINDOWS = [7, 28, 90] as const;
export type AnalyticsWindowDays = (typeof ANALYTICS_WINDOWS)[number];

export interface AnalyticsRate {
  numerator: number;
  denominator: number;
  percent: number | null;
}

export interface AnalyticsDimension {
  key: string;
  tasks: number;
  results: number;
  qualified: number;
  conversations: number;
  qualifiedPer100: number | null;
}

export interface AnalyticsReport {
  campaign: { id: string; name: string };
  window: { days: AnalyticsWindowDays; start: string; end: string };
  search: {
    completedTasks: number;
    results: number;
    highQualityCandidates: number;
    effectiveConversations: number;
    qualifiedPer100: number | null;
    highQualityToConversation: AnalyticsRate;
  };
  funnel: {
    imported: number;
    highQuality: number;
    contacted: number;
    replied: number;
    interviewed: number;
    offered: number;
    hired: number;
  };
  speed: { medianHoursToFirstReply: number | null; replySamples: number };
  strategy: {
    current: StrategyPerformance | null;
    previous: StrategyPerformance | null;
    gainPercent: number | null;
    sampleReady: boolean;
    sampleMessage: string;
  };
  intelligence: {
    organizations: number;
    coveredOrganizations: number;
    formalCoverage: AnalyticsRate;
    totalClaims: number;
    disputedClaims: number;
    staleClaims: number;
    conflictRate: AnalyticsRate;
    staleRate: AnalyticsRate;
  };
  resumeQuality: {
    assessed: number;
    quarantined: number;
    blockedRate: AnalyticsRate;
    reviewed: number;
    restored: number;
    falseKillRate: AnalyticsRate;
  };
  dimensions: { companies: AnalyticsDimension[]; keywords: AnalyticsDimension[] };
  dataQuality: {
    score: number | null;
    feedbackCoverage: AnalyticsRate;
    originAttributionCoverage: AnalyticsRate;
    quarantineReviewCoverage: AnalyticsRate;
    issues: string[];
  };
  generatedAt: string;
}

export interface StrategyPerformance {
  id: string;
  version: number;
  tasks: number;
  results: number;
  qualified: number;
  conversations: number;
  score: number | null;
}

export interface AnalyticsSnapshot {
  id: string;
  campaignId: string;
  businessDate: string;
  windowDays: AnalyticsWindowDays;
  metrics: AnalyticsReport;
  dimensions: AnalyticsReport["dimensions"];
  dataQuality: AnalyticsReport["dataQuality"];
  createdAt: string;
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentage(numerator: number, denominator: number) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : null;
}

function rate(numerator: number, denominator: number): AnalyticsRate {
  return { numerator, denominator, percent: percentage(numerator, denominator) };
}

function shanghaiBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dimensionFrom(key: string, values: { tasks: Set<string>; results: number; qualified: number; conversations: number }): AnalyticsDimension {
  return {
    key,
    tasks: values.tasks.size,
    results: values.results,
    qualified: values.qualified,
    conversations: values.conversations,
    qualifiedPer100: values.results ? Number(((values.qualified / values.results) * 100).toFixed(1)) : null,
  };
}

function strategyPerformance(row: Row | undefined, feedback: Row[]) {
  if (!row) return null;
  const id = String(row.id);
  const matched = feedback.filter((item) => item.strategy_version_id === id);
  const tasks = new Set(matched.map((item) => String(item.task_id))).size;
  const results = matched.reduce((sum, item) => sum + Number(item.result_count || 0), 0);
  const qualified = matched.reduce((sum, item) => sum + Number(item.qualified_count || 0), 0);
  const conversations = matched.reduce((sum, item) => sum + Number(item.effective_conversations || 0), 0);
  const qualifiedRate = results ? qualified / results : 0;
  const conversationRate = qualified ? conversations / qualified : 0;
  return {
    id,
    version: Number(row.version),
    tasks,
    results,
    qualified,
    conversations,
    score: results ? Number((qualifiedRate * 0.45 + conversationRate * 0.55).toFixed(4)) : null,
  } satisfies StrategyPerformance;
}

export function normalizeAnalyticsWindow(value: string | number | null | undefined): AnalyticsWindowDays {
  const parsed = Number(value);
  return ANALYTICS_WINDOWS.includes(parsed as AnalyticsWindowDays) ? parsed as AnalyticsWindowDays : 28;
}

export function defaultAnalyticsCampaignId() {
  const row = db.prepare("SELECT id FROM campaigns ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1").get() as { id: string } | undefined;
  return row?.id || null;
}

export function computeAnalyticsReport(campaignId: string, windowDays: AnalyticsWindowDays = 28, endDate = new Date()): AnalyticsReport {
  const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ?").get(campaignId) as Row | undefined;
  if (!campaign) throw new Error("寻访战役不存在");
  const end = endDate.toISOString();
  const start = new Date(endDate.getTime() - windowDays * 86_400_000).toISOString();
  const feedback = db.prepare(`SELECT f.*, s.id AS task_id, s.company_name, s.query_json, s.strategy_version_id
    FROM search_task_feedback f JOIN search_tasks s ON s.id = f.task_id
    WHERE s.campaign_id = ? AND f.created_at >= ? AND f.created_at <= ?`).all(campaignId, start, end) as Row[];
  const results = feedback.reduce((sum, item) => sum + Number(item.result_count || 0), 0);
  const qualified = feedback.reduce((sum, item) => sum + Number(item.qualified_count || 0), 0);
  const conversations = feedback.reduce((sum, item) => sum + Number(item.effective_conversations || 0), 0);

  const events = db.prepare(`SELECT event_type, person_id, resume_id, search_task_id, occurred_at
    FROM activity_events WHERE campaign_id = ? AND occurred_at >= ? AND occurred_at <= ?`).all(campaignId, start, end) as Row[];
  const distinctForEvent = (eventType: string, field: "person_id" | "resume_id" = "person_id") => new Set(events
    .filter((item) => item.event_type === eventType && item[field])
    .map((item) => String(item[field]))).size;
  const imported = distinctForEvent("RESUME_IMPORTED", "resume_id");
  const contacted = distinctForEvent("CONTACT_RECORDED");
  const replied = distinctForEvent("REPLY_RECORDED");
  const interviewed = distinctForEvent("INTERVIEW_RECORDED");
  const offered = distinctForEvent("OFFER_RECORDED");
  const hired = distinctForEvent("HIRED_RECORDED");

  const replyDurations = (db.prepare(`SELECT s.created_at AS task_created_at, MIN(e.occurred_at) AS first_reply_at
    FROM search_tasks s JOIN activity_events e ON e.search_task_id = s.id AND e.event_type = 'REPLY_RECORDED'
    WHERE s.campaign_id = ? AND e.occurred_at >= ? AND e.occurred_at <= ?
    GROUP BY s.id, s.created_at`).all(campaignId, start, end) as Row[])
    .map((item) => (new Date(String(item.first_reply_at)).getTime() - new Date(String(item.task_created_at)).getTime()) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const medianReply = median(replyDurations);

  const activeStrategy = db.prepare("SELECT * FROM strategy_versions WHERE campaign_id = ? AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1").get(campaignId) as Row | undefined;
  const previousStrategy = activeStrategy?.parent_version_id
    ? db.prepare("SELECT * FROM strategy_versions WHERE id = ?").get(String(activeStrategy.parent_version_id)) as Row | undefined
    : activeStrategy ? db.prepare("SELECT * FROM strategy_versions WHERE campaign_id = ? AND version < ? ORDER BY version DESC LIMIT 1").get(campaignId, Number(activeStrategy.version)) as Row | undefined : undefined;
  const currentPerformance = strategyPerformance(activeStrategy, feedback);
  const previousPerformance = strategyPerformance(previousStrategy, feedback);
  const sampleReady = Boolean(currentPerformance && previousPerformance
    && currentPerformance.tasks >= 5 && previousPerformance.tasks >= 5
    && currentPerformance.results >= 30 && previousPerformance.results >= 30);
  const strategyGain = sampleReady && currentPerformance && previousPerformance && currentPerformance.score !== null && previousPerformance.score
    ? Number((((currentPerformance.score - previousPerformance.score) / previousPerformance.score) * 100).toFixed(1))
    : null;
  const sampleMessage = !currentPerformance || !previousPerformance ? "需要至少两个策略版本"
    : !sampleReady ? "新旧策略均需至少 5 个任务和 30 个搜索结果"
      : previousPerformance.score === 0 ? "上一版基线为 0，暂不计算增益" : "样本达到自动比较门槛";

  const organizationHealth = db.prepare(`SELECT COUNT(DISTINCT co.organization_id) AS organizations,
      COUNT(DISTINCT CASE WHEN ec.status = 'PROMOTED' AND ec.classification = 'FACT' THEN co.organization_id END) AS covered_organizations,
      COUNT(DISTINCT ec.id) AS total_claims,
      COUNT(DISTINCT CASE WHEN ec.status = 'DISPUTED' OR ec.classification = 'DISPUTED' THEN ec.id END) AS disputed_claims,
      COUNT(DISTINCT CASE WHEN ec.status = 'STALE' THEN ec.id END) AS stale_claims
    FROM campaign_organizations co
    LEFT JOIN evidence_claims ec ON ec.organization_id = co.organization_id
    WHERE co.campaign_id = ?`).get(campaignId) as Row;
  const organizations = Number(organizationHealth.organizations || 0);
  const coveredOrganizations = Number(organizationHealth.covered_organizations || 0);
  const totalClaims = Number(organizationHealth.total_claims || 0);
  const disputedClaims = Number(organizationHealth.disputed_claims || 0);
  const staleClaims = Number(organizationHealth.stale_claims || 0);

  const resumeCounts = db.prepare(`SELECT COUNT(*) AS assessed,
      COALESCE(SUM(CASE WHEN quality_grade = 'QUARANTINED' THEN 1 ELSE 0 END), 0) AS quarantined
    FROM resume_documents WHERE campaign_id = ? AND quality_assessed_at IS NOT NULL AND created_at >= ? AND created_at <= ?`).get(campaignId, start, end) as Row;
  const assessed = Number(resumeCounts.assessed || 0);
  const quarantined = Number(resumeCounts.quarantined || 0);
  const reviewRows = db.prepare(`SELECT resume_id, decision, created_at FROM resume_quality_reviews
    WHERE campaign_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC`).all(campaignId, start, end) as Row[];
  const latestReviews = new Map<string, string>();
  for (const review of reviewRows) if (!latestReviews.has(String(review.resume_id))) latestReviews.set(String(review.resume_id), String(review.decision));
  const reviewed = latestReviews.size;
  const restored = [...latestReviews.values()].filter((decision) => decision === "RESTORED").length;

  const companies = new Map<string, { tasks: Set<string>; results: number; qualified: number; conversations: number }>();
  const keywords = new Map<string, { tasks: Set<string>; results: number; qualified: number; conversations: number }>();
  for (const item of feedback) {
    const taskId = String(item.task_id);
    const accumulate = (target: Map<string, { tasks: Set<string>; results: number; qualified: number; conversations: number }>, key: string) => {
      if (!key) return;
      const value = target.get(key) || { tasks: new Set<string>(), results: 0, qualified: 0, conversations: 0 };
      value.tasks.add(taskId);
      value.results += Number(item.result_count || 0);
      value.qualified += Number(item.qualified_count || 0);
      value.conversations += Number(item.effective_conversations || 0);
      target.set(key, value);
    };
    accumulate(companies, String(item.company_name || "未指定公司"));
    try {
      const query = json<{ keywords?: string[] }>(String(item.query_json || "{}"));
      for (const keyword of query.keywords || []) accumulate(keywords, keyword.trim());
    } catch { /* Invalid legacy task JSON is reflected in attribution coverage instead of breaking the dashboard. */ }
  }
  const ranked = (values: Map<string, { tasks: Set<string>; results: number; qualified: number; conversations: number }>) => [...values.entries()]
    .map(([key, value]) => dimensionFrom(key, value))
    .sort((left, right) => (right.qualified - left.qualified) || (right.results - left.results))
    .slice(0, 8);

  const completedTasks = Number((db.prepare(`SELECT COUNT(*) AS count FROM search_tasks
    WHERE campaign_id = ? AND completed_at >= ? AND completed_at <= ? AND status IN ('COMPLETED','NO_RESULT','LOW_QUALITY')`).get(campaignId, start, end) as Row).count || 0);
  const feedbackTasks = new Set(feedback.map((item) => String(item.task_id))).size;
  const importedEvents = events.filter((item) => item.event_type === "RESUME_IMPORTED" && item.resume_id);
  const attributedImports = new Set(importedEvents.filter((item) => item.search_task_id).map((item) => String(item.resume_id))).size;
  const importedResumes = new Set(importedEvents.map((item) => String(item.resume_id))).size;
  const feedbackCoverage = rate(feedbackTasks, completedTasks);
  const originCoverage = rate(attributedImports, importedResumes);
  const reviewCoverage = rate(reviewed, quarantined);
  const qualityComponents = [
    completedTasks ? feedbackCoverage.percent ?? 0 : null,
    importedResumes ? originCoverage.percent ?? 0 : null,
    quarantined ? reviewCoverage.percent ?? 0 : null,
  ].filter((value): value is number => value !== null);
  const dataQualityScore = qualityComponents.length
    ? bounded(Math.round(qualityComponents.reduce((sum, value) => sum + value, 0) / qualityComponents.length), 0, 100)
    : null;
  const issues: string[] = [];
  if (completedTasks && (feedbackCoverage.percent || 0) < 80) issues.push("完成任务的搜索反馈覆盖率低于 80%");
  if (importedResumes && (originCoverage.percent || 0) < 80) issues.push("入库简历的来源任务归因覆盖率低于 80%");
  if (quarantined && !reviewed) issues.push("隔离简历尚无人工质量复核样本");
  if (!replyDurations.length) issues.push("尚无可计算任务响应速度的有效回复事件");
  if (!sampleReady) issues.push(`策略增益样本不足：${sampleMessage}`);
  if (!qualityComponents.length) issues.push("当前窗口尚无可评估的数据完整性样本");

  const generatedAt = now();
  return {
    campaign: { id: String(campaign.id), name: String(campaign.name) },
    window: { days: windowDays, start, end },
    search: {
      completedTasks,
      results,
      highQualityCandidates: qualified,
      effectiveConversations: conversations,
      qualifiedPer100: results ? Number(((qualified / results) * 100).toFixed(1)) : null,
      highQualityToConversation: rate(conversations, qualified),
    },
    funnel: { imported, highQuality: qualified, contacted, replied, interviewed, offered, hired },
    speed: { medianHoursToFirstReply: medianReply === null ? null : Number(medianReply.toFixed(1)), replySamples: replyDurations.length },
    strategy: { current: currentPerformance, previous: previousPerformance, gainPercent: strategyGain, sampleReady, sampleMessage },
    intelligence: {
      organizations, coveredOrganizations, formalCoverage: rate(coveredOrganizations, organizations), totalClaims, disputedClaims, staleClaims,
      conflictRate: rate(disputedClaims, totalClaims), staleRate: rate(staleClaims, totalClaims),
    },
    resumeQuality: { assessed, quarantined, blockedRate: rate(quarantined, assessed), reviewed, restored, falseKillRate: rate(restored, reviewed) },
    dimensions: { companies: ranked(companies), keywords: ranked(keywords) },
    dataQuality: { score: dataQualityScore, feedbackCoverage, originAttributionCoverage: originCoverage, quarantineReviewCoverage: reviewCoverage, issues },
    generatedAt,
  };
}

function snapshotFrom(row: Row): AnalyticsSnapshot {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    businessDate: String(row.business_date),
    windowDays: Number(row.window_days) as AnalyticsWindowDays,
    metrics: json<AnalyticsReport>(String(row.metrics_json)),
    dimensions: json<AnalyticsReport["dimensions"]>(String(row.dimensions_json)),
    dataQuality: json<AnalyticsReport["dataQuality"]>(String(row.data_quality_json)),
    createdAt: String(row.created_at),
  };
}

export function createAnalyticsSnapshot(campaignId: string, windowDays: AnalyticsWindowDays, endDate = new Date()) {
  const report = computeAnalyticsReport(campaignId, windowDays, endDate);
  const businessDate = shanghaiBusinessDate(endDate);
  const createdAt = now();
  db.prepare(`INSERT INTO analytics_snapshots
    (id, campaign_id, business_date, window_days, metrics_json, dimensions_json, data_quality_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, business_date, window_days) DO UPDATE SET
      metrics_json = excluded.metrics_json, dimensions_json = excluded.dimensions_json,
      data_quality_json = excluded.data_quality_json, created_at = excluded.created_at`)
    .run(randomUUID(), campaignId, businessDate, windowDays, JSON.stringify(report), JSON.stringify(report.dimensions), JSON.stringify(report.dataQuality), createdAt);
  const row = db.prepare("SELECT * FROM analytics_snapshots WHERE campaign_id = ? AND business_date = ? AND window_days = ?")
    .get(campaignId, businessDate, windowDays) as Row;
  return snapshotFrom(row);
}

export function listAnalyticsSnapshots(campaignId: string, windowDays: AnalyticsWindowDays, limit = 30) {
  return (db.prepare(`SELECT * FROM analytics_snapshots WHERE campaign_id = ? AND window_days = ?
    ORDER BY business_date DESC LIMIT ?`).all(campaignId, windowDays, bounded(limit, 1, 180)) as Row[]).map(snapshotFrom);
}

export function ensureDailyAnalyticsSnapshots(endDate = new Date()) {
  const campaigns = db.prepare("SELECT id FROM campaigns WHERE status = 'ACTIVE' ORDER BY id").all() as Array<{ id: string }>;
  const snapshots: AnalyticsSnapshot[] = [];
  for (const campaign of campaigns) for (const windowDays of ANALYTICS_WINDOWS) snapshots.push(createAnalyticsSnapshot(campaign.id, windowDays, endDate));
  return snapshots;
}
