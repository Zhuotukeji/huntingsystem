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
