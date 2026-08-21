export const campaignStatusLabels: Record<string, string> = {
  DRAFT: "草稿", ACTIVE: "运行中", PAUSED: "已暂停", COMPLETED: "已完成",
};

export const organizationStatusLabels: Record<string, string> = {
  PENDING_REVIEW: "待审核", APPROVED: "已批准", WATCHLIST: "观察", REJECTED: "已排除",
};

export { PERSON_STATUS_LABELS as personStatusLabels } from "@/lib/person-workflow";

export function shortDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
