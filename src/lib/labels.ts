export const campaignStatusLabels: Record<string, string> = {
  DRAFT: "草稿", ACTIVE: "运行中", PAUSED: "已暂停", COMPLETED: "已完成",
};

export const organizationStatusLabels: Record<string, string> = {
  PENDING_REVIEW: "待审核", APPROVED: "已批准", WATCHLIST: "观察", REJECTED: "已排除",
};

export const personStatusLabels: Record<string, string> = {
  PENDING_REVIEW: "待审核", NEEDS_RESEARCH: "待补充", READY_TO_CONTACT: "待联系", CONTACTED: "已联系", ENGAGED: "沟通中", CONVERTED: "已转候选人", TALENT_POOL: "人才库", CLOSED: "已关闭", DO_NOT_CONTACT: "请勿联系",
};

export const taskStatusLabels: Record<string, string> = {
  QUEUED: "排队中", RUNNING: "运行中", WAITING_HUMAN: "等待 HR", WAITING_REVIEW: "等待审核", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消",
};

export const taskTypeLabels: Record<string, string> = {
  GENERATE_STRATEGY: "策略生成", DISCOVER_ORGANIZATIONS: "公司发现", DISCOVER_PERSONS: "人员发现", MANUAL_INSIGHTTRACKER_RESEARCH: "InsightTracker 调研", IMPORT_SOURCE: "资料解析",
};

export function shortDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
