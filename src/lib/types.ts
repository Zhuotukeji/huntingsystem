export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
export type OrganizationStatus = "AI_LEARNED" | "WATCHLIST" | "REJECTED";
export type OrganizationBusinessStatus = "GROWING" | "STABLE" | "TRANSFORMING" | "CONTRACTING" | "UNKNOWN";

export interface Campaign {
  id: string;
  name: string;
  roleName: string;
  status: CampaignStatus;
  ownerName: string;
  businessGoal: string;
  valueProposition: string;
  locations: string[];
  markets: string[];
  channels: string[];
  mustHaves: string[];
  niceToHaves: string[];
  exclusions: string[];
  targetOrganizationCount: number;
  targetPersonCount: number;
  weeklyTarget: number;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  entityType: "ORGANIZATION" | "PERSON";
  entityId: string;
  classification: "FACT" | "INFERENCE" | "PREDICTION" | "DISPUTED" | "CONFLICT";
  claimText: string;
  quote: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceProvider: string;
  confidence: number;
  observedAt: string;
}

export interface CampaignOrganization {
  id: string;
  campaignId: string;
  organizationId: string;
  name: string;
  domain: string;
  location: string;
  size: string;
  description: string;
  category: string;
  status: OrganizationStatus;
  products: string[];
  markets: string[];
  channels: string[];
  monetization: string[];
  businessHistory: string[];
  currentBusiness: string[];
  businessStatus: OrganizationBusinessStatus;
  businessStatusSummary: string;
  businessSignals: string[];
  businessStatusConfidence: number;
  fitScore: number;
  evidenceCoverage: number;
  confidence: number;
  evidenceSourceCount: number;
  sourceQualityScore: number;
  recommendationReason: string;
  unknowns: string[];
  ownerName: string;
  updatedAt: string;
  evidence: Evidence[];
  talentCount: number;
  roleNames: string[];
}

export type PersonStatus =
  | "PENDING_REVIEW"
  | "NEEDS_RESEARCH"
  | "READY_TO_CONTACT"
  | "CONTACTED"
  | "ENGAGED"
  | "SCREENING"
  | "CONVERTED"
  | "INTERVIEWING"
  | "OFFERED"
  | "HIRED"
  | "TALENT_POOL"
  | "CLOSED"
  | "WITHDRAWN"
  | "DO_NOT_CONTACT";

export type CandidateAutoProgressStatus =
  | "NEEDS_RESEARCH"
  | "READY_TO_CONTACT"
  | "TALENT_POOL"
  | "CLOSED"
  | "DO_NOT_CONTACT";

export interface CandidateAutoProgressRule {
  id: string;
  minimum: number;
  maximum: number;
  targetStatus: CandidateAutoProgressStatus;
  enabled: boolean;
}

export interface CandidateAutomationSettings {
  rules: CandidateAutoProgressRule[];
  searchTaskMinimumScore: number;
  resumeQualityPolicy: ResumeQualityPolicy;
  updatedAt: string | null;
}

export interface ResumeQualityPolicy {
  quarantineBelow: number;
  graphMinimumScore: number;
  highConfidenceMinimumScore: number;
  organizationSearchMinimumConfidence: number;
  organizationSearchMinimumSources: number;
  businessFactMinimumSources: number;
  maxOrganizationsPerResume: number;
  maxSkillsPerResume: number;
}

export interface PersonStageEvent {
  id: string;
  status: string;
  reason: string;
  operatorName: string;
  createdAt: string;
}

export interface CampaignPerson {
  id: string;
  campaignId: string;
  personId: string;
  name: string;
  headline: string;
  location: string;
  organizationName: string;
  slot: string;
  status: PersonStatus;
  fitScore: number;
  evidenceCoverage: number;
  identityConfidence: number;
  recommendationReason: string;
  strengths: string[];
  unknowns: string[];
  riskFlags: string[];
  ownerName: string;
  reviewReason: string;
  lastInteractionAt: string | null;
  updatedAt: string;
  evidence: Evidence[];
  stageHistory: PersonStageEvent[];
  origins: CandidateOrigin[];
  activityEvents: ActivityEvent[];
}

export type TaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_HUMAN"
  | "WAITING_REVIEW"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface AgentTask {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  type: string;
  status: TaskStatus;
  title: string;
  resultSummary: string;
  payload: Record<string, unknown>;
  steps: string[];
  attempts: number;
  maxAttempts: number;
  modelName: string;
  estimatedCost: number;
  createdAt: string;
  completedAt: string | null;
}

export interface DashboardData {
  metrics: {
    learnedCompanies: number;
    pendingPeople: number;
    readyToContact: number;
    highMatchEngaged: number;
    weeklyGoal: number;
    estimatedHoursSaved: number;
  };
  campaigns: Array<Campaign & { organizationCount: number; personCount: number }>;
  urgentTasks: AgentTask[];
  recentPeople: CampaignPerson[];
  funnel: Array<{ label: string; value: number; color: string }>;
}

export type ResumeStatus = "PENDING" | "PROCESSING" | "READY" | "NEEDS_REVIEW" | "QUARANTINED" | "FAILED";
export type ResumeIdentityDecision = "AUTO_MERGED" | "NEW_PROFILE" | "REVIEW_REQUIRED" | "EXISTING_LINK";
export type ResumeQualityGrade = "UNASSESSED" | "PREFLIGHT" | "QUARANTINED" | "NEEDS_REVIEW" | "GRAPH_ELIGIBLE" | "HIGH_CONFIDENCE";

export interface ResumeDocument {
  id: string;
  campaignId: string;
  campaignName: string;
  personId: string | null;
  personName: string | null;
  fileName: string;
  mimeType: string;
  sourceType: string;
  legalBasis: string;
  contentHash: string;
  status: ResumeStatus;
  qualityScore: number;
  qualityGrade: ResumeQualityGrade;
  qualityReasons: string[];
  qualityMetrics: Record<string, number | string | boolean>;
  graphEligible: boolean;
  searchEligible: boolean;
  qualityAssessedAt: string | null;
  parseVersion: string;
  errorMessage: string;
  retentionUntil: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  analyzedAt: string | null;
  sourceSearchTaskId: string | null;
  sourceStrategyVersionId: string | null;
  experimentAssignmentId: string | null;
}

export interface ResumeProfile extends ResumeDocument {
  personHeadline: string;
  personLocation: string;
  identityDecision: ResumeIdentityDecision | null;
  identityScore: number | null;
  identityConfidence: number | null;
  identityReasons: string[];
  identityCandidateCount: number;
  identityMatchedPersonId: string | null;
  identityMatchedPersonName: string | null;
  employments: EmploymentRecord[];
  skills: Array<{ name: string; category: string; confidence: number; evidenceText: string }>;
}

export interface EmploymentRecord {
  id: string;
  personId: string;
  organizationId: string;
  organizationName: string;
  rawTitle: string;
  normalizedRole: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  summary: string;
  confidence: number;
}

export type AiRunStatus = "QUEUED" | "RUNNING" | "PARTIAL_SUCCESS" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface AiRun {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  runType: "NIGHTLY" | "MANUAL" | "UPLOAD" | "REBUILD";
  businessDate: string | null;
  status: AiRunStatus;
  stage: string;
  scope: Record<string, unknown>;
  summary: string;
  metrics: Record<string, number>;
  errorMessage: string;
  triggeredBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type SearchTaskStatus = "NEW" | "CLAIMED" | "IN_PROGRESS" | "COMPLETED" | "NO_RESULT" | "LOW_QUALITY" | "DEFERRED" | "EXPIRED" | "CANCELLED";

export interface SearchTask {
  id: string;
  campaignId: string;
  campaignName: string;
  runId: string | null;
  taskType: string;
  title: string;
  companyName: string;
  query: {
    keywords: string[];
    locations: string[];
    experience: string;
    instructions: string[];
  };
  reason: {
    summary: string;
    evidence: string[];
    expectedCandidate: string;
  };
  priority: number;
  status: SearchTaskStatus;
  claimedBy: string | null;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  strategyVersionId: string | null;
  experimentAssignmentId: string | null;
}

export type ActivityEventType =
  | "SEARCH_TASK_CREATED"
  | "SEARCH_TASK_CLAIMED"
  | "SEARCH_STARTED"
  | "SEARCH_FEEDBACK_RECORDED"
  | "RESUME_SCANNED"
  | "RESUME_IMPORTED"
  | "RESUME_QUALITY_RESTORED"
  | "RESUME_QUARANTINE_CONFIRMED"
  | "CANDIDATE_CREATED"
  | "CANDIDATE_STAGE_CHANGED"
  | "CONTACT_RECORDED"
  | "REPLY_RECORDED"
  | "INTERVIEW_RECORDED"
  | "OFFER_RECORDED"
  | "HIRED_RECORDED"
  | "CANDIDATE_REJECTED"
  | "STRATEGY_ACTIVATED"
  | "STRATEGY_ROLLED_BACK"
  | "REVIEW_COMPLETED"
  | "RESEARCH_BLOCKED"
  | "RESEARCH_COMPLETED";

export interface ActivityEvent {
  id: string;
  campaignId: string | null;
  personId: string | null;
  organizationId: string | null;
  resumeId: string | null;
  searchTaskId: string | null;
  strategyVersionId: string | null;
  experimentAssignmentId: string | null;
  eventType: ActivityEventType;
  fromStatus: string | null;
  toStatus: string | null;
  reasonCode: string;
  actorType: "AI" | "USER" | "PLUGIN" | "SYSTEM";
  actorId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface CandidateOrigin {
  id: string;
  campaignId: string;
  personId: string;
  resumeId: string | null;
  searchTaskId: string | null;
  organizationId: string | null;
  strategyVersionId: string | null;
  experimentAssignmentId: string | null;
  keywords: string[];
  sourceType: string;
  createdAt: string;
}

export type StrategyVersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ROLLED_BACK";

export interface StrategySnapshot {
  targetOrganizations: Array<{ id: string; name: string; weight: number }>;
  keywordGroups: string[][];
  locations: string[];
  searchTaskMinimumScore: number;
  greetingPolicy: string;
  explorationPercent: number;
  constraints: { maximumWeightDelta: number; minimumWeight: number; maximumWeight: number };
}

export interface StrategyVersion {
  id: string;
  campaignId: string;
  version: number;
  status: StrategyVersionStatus;
  parentVersionId: string | null;
  sourceReviewRunId: string | null;
  strategy: StrategySnapshot;
  changeSummary: string;
  createdBy: string;
  createdAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
}

export interface ReviewRun {
  id: string;
  campaignId: string | null;
  reviewType: "DAILY" | "WEEKLY" | "MANUAL";
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  windowStart: string;
  windowEnd: string;
  metrics: Record<string, number>;
  diagnosis: string[];
  proposedChanges: Array<Record<string, unknown>>;
  appliedChanges: Array<Record<string, unknown>>;
  confidence: number;
  modelName: string;
  estimatedCost: number;
  errorMessage: string;
  triggeredBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface Experiment {
  id: string;
  campaignId: string;
  strategyVersionId: string | null;
  name: string;
  dimension: "COMPANY" | "KEYWORD" | "GREETING";
  status: "DRAFT" | "RUNNING" | "COMPLETED" | "CANCELLED";
  primaryMetric: string;
  allocationPercent: number;
  minimumTasks: number;
  minimumResults: number;
  arms: Array<{ key: string; label: string; value: string }>;
  result: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type ClaimClassification = "FACT" | "INFERENCE" | "PREDICTION" | "DISPUTED";
export type ClaimStatus = "CANDIDATE" | "PROMOTED" | "DISPUTED" | "STALE" | "REJECTED";
export type TrustTier = "OFFICIAL" | "REPUTABLE" | "INDUSTRY" | "WEAK";

export interface IntelligenceSource {
  id: string;
  organizationId: string | null;
  sourceType: string;
  trustTier: TrustTier;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  quote: string;
  contentHash: string;
  collectedAt: string;
}

export interface EvidenceClaim {
  id: string;
  organizationId: string | null;
  subjectType: "ORGANIZATION" | "PROJECT" | "BUSINESS_UNIT";
  subjectId: string;
  claimType: string;
  classification: ClaimClassification;
  statement: string;
  value: Record<string, unknown>;
  confidence: number;
  status: ClaimStatus;
  validFrom: string | null;
  validUntil: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceIds: string[];
}

export interface IntelligenceProject {
  id: string;
  organizationId: string;
  organizationName: string;
  businessUnitId: string | null;
  name: string;
  projectType: "CLIENT_DELIVERY" | "TENDER" | "PRODUCT_LAUNCH" | "REGIONAL_EXPANSION" | "NEW_BUSINESS" | "ORGANIZATION_CHANGE";
  status: string;
  region: string;
  clientName: string;
  products: string[];
  skills: string[];
  summary: string;
  confidence: number;
  talentDemandConfidence: number;
  startedAt: string | null;
  endedAt: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  claims: EvidenceClaim[];
}

export interface OrganizationEvent {
  id: string;
  organizationId: string;
  eventType: string;
  title: string;
  summary: string;
  classification: ClaimClassification;
  confidence: number;
  occurredAt: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface ResearchTask {
  id: string;
  campaignId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  topic: string;
  triggerType: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED_CONFIGURATION";
  resultSummary: string;
  errorMessage: string;
  attempts: number;
  modelName: string;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AutonomySettings {
  enabled: boolean;
  webResearchEnabled: boolean;
  webSearchCapability: "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";
  researchDailyLimit: number;
  researchConcurrency: number;
  researchCooldownDays: number;
  currentBusinessFreshnessDays: number;
  hiringSignalFreshnessDays: number;
  projectFreshnessDays: number;
  claimPromotionMinimumConfidence: number;
  projectSearchMinimumConfidence: number;
  talentDemandMinimumConfidence: number;
  reviewMinimumTasks: number;
  reviewMinimumResults: number;
  explorationPercent: number;
  maximumWeightDelta: number;
  updatedAt: string | null;
}

export interface GraphNode {
  id: string;
  type: "PERSON" | "ORGANIZATION" | "SKILL";
  label: string;
  detail: string;
  score: number;
  status: string;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  weight: number;
  confidence: number;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: {
    people: number;
    organizations: number;
    skills: number;
    evidenceBackedEdges: number;
  };
  companyInsights: Array<{
    organizationId: string;
    name: string;
    talentCount: number;
    targetRoleCount: number;
    score: number;
    reasons: string[];
  }>;
}

export interface AiProviderSettings {
  provider: "sub2api";
  baseUrl: string;
  model: string;
  apiStyle: "chat_completions" | "responses";
  hasApiKey: boolean;
  maskedApiKey: string;
  enabled: boolean;
  screenAnalysisEnabled: boolean;
  updatedAt: string | null;
}

export interface LearningRecommendation {
  id: string;
  campaignId: string;
  runId: string | null;
  recommendationType: string;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  confidence: number;
  status: "PENDING_REVIEW" | "AUTO_APPLIED" | "APPROVED" | "REJECTED";
  createdAt: string;
}
