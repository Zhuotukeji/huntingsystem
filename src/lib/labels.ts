export const campaignStatusLabels: Record<string, string> = {
  DRAFT: "草稿", ACTIVE: "运行中", PAUSED: "已暂停", COMPLETED: "已完成",
};

export const organizationStatusLabels: Record<string, string> = {
  PENDING_REVIEW: "待审核", APPROVED: "已批准", WATCHLIST: "观察", REJECTED: "已排除",
};

export const personStatusLabels: Record<string, string> = {
  PENDING_REVIEW: "待审核", NEEDS_RESEARCH: "待补充", READY_TO_CONTACT: "待联系", CONTACTED: "已联系", ENGAGED: "沟通中", CONVERTED: "已转候选人", TALENT_POOL: "人才库", CLOSED: "已关闭", DO_NOT_CONTACT: "请勿联系",
};

export function shortDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
