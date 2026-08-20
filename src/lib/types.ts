export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
export type ReviewStatus = "PENDING_REVIEW" | "APPROVED" | "WATCHLIST" | "REJECTED";

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
  classification: "FACT" | "INFERENCE" | "CONFLICT";
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
  category: string;
  status: ReviewStatus;
  products: string[];
  markets: string[];
  channels: string[];
  monetization: string[];
  fitScore: number;
  evidenceCoverage: number;
  confidence: number;
  recommendationReason: string;
  unknowns: string[];
  ownerName: string;
  updatedAt: string;
  evidence: Evidence[];
}

export type PersonStatus =
  | "PENDING_REVIEW"
  | "NEEDS_RESEARCH"
  | "READY_TO_CONTACT"
  | "CONTACTED"
  | "ENGAGED"
  | "CONVERTED"
  | "TALENT_POOL"
  | "CLOSED"
  | "DO_NOT_CONTACT";

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
  lastInteractionAt: string | null;
  updatedAt: string;
  evidence: Evidence[];
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
    pendingCompanies: number;
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

export type ResumeStatus = "PENDING" | "PROCESSING" | "READY" | "NEEDS_REVIEW" | "FAILED";

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
  parseVersion: string;
  errorMessage: string;
  retentionUntil: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  analyzedAt: string | null;
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
