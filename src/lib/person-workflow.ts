import type { PersonStatus } from "@/lib/types";

export const PERSON_STATUS_LABELS: Record<PersonStatus, string> = {
  PENDING_REVIEW: "待审核",
  NEEDS_RESEARCH: "待补充",
  READY_TO_CONTACT: "待联系",
  CONTACTED: "已联系",
  ENGAGED: "有效沟通",
  SCREENING: "初筛中",
  CONVERTED: "初筛通过",
  INTERVIEWING: "面试中",
  OFFERED: "已发 Offer",
  HIRED: "已入职",
  TALENT_POOL: "人才库",
  CLOSED: "本战役淘汰",
  WITHDRAWN: "候选人退出",
  DO_NOT_CONTACT: "请勿联系",
};

export const PERSON_STATUS_DESCRIPTIONS: Record<PersonStatus, string> = {
  PENDING_REVIEW: "等待 HR 根据画像和证据判断",
  NEEDS_RESEARCH: "关键信息不足，等待补充",
  READY_TO_CONTACT: "已通过审核，等待首次触达",
  CONTACTED: "已发送招呼或建立首次联系",
  ENGAGED: "候选人已回应并完成实质性双向沟通",
  SCREENING: "正在确认意愿、能力、薪资和到岗条件",
  CONVERTED: "历史状态，等同初筛通过",
  INTERVIEWING: "已进入正式面试流程",
  OFFERED: "已发出 Offer，等待接受或入职",
  HIRED: "候选人已接受并完成入职",
  TALENT_POOL: "本战役暂不推进，但保留长期人才资产",
  CLOSED: "不符合当前战役要求，停止推进",
  WITHDRAWN: "候选人主动退出当前流程",
  DO_NOT_CONTACT: "存在明确限制，不应继续联系",
};

export const PERSON_STATUS_TRANSITIONS: Record<PersonStatus, PersonStatus[]> = {
  PENDING_REVIEW: ["READY_TO_CONTACT", "NEEDS_RESEARCH", "TALENT_POOL", "CLOSED", "DO_NOT_CONTACT"],
  NEEDS_RESEARCH: ["PENDING_REVIEW", "READY_TO_CONTACT", "TALENT_POOL", "CLOSED"],
  READY_TO_CONTACT: ["CONTACTED", "TALENT_POOL", "CLOSED", "DO_NOT_CONTACT"],
  CONTACTED: ["ENGAGED", "READY_TO_CONTACT", "TALENT_POOL", "CLOSED", "WITHDRAWN", "DO_NOT_CONTACT"],
  ENGAGED: ["SCREENING", "CONTACTED", "TALENT_POOL", "CLOSED", "WITHDRAWN", "DO_NOT_CONTACT"],
  SCREENING: ["INTERVIEWING", "ENGAGED", "TALENT_POOL", "CLOSED", "WITHDRAWN"],
  CONVERTED: ["INTERVIEWING", "ENGAGED", "TALENT_POOL", "CLOSED", "WITHDRAWN"],
  INTERVIEWING: ["OFFERED", "SCREENING", "TALENT_POOL", "CLOSED", "WITHDRAWN"],
  OFFERED: ["HIRED", "INTERVIEWING", "TALENT_POOL", "CLOSED", "WITHDRAWN"],
  HIRED: [],
  TALENT_POOL: ["READY_TO_CONTACT", "CLOSED", "DO_NOT_CONTACT"],
  CLOSED: ["READY_TO_CONTACT", "TALENT_POOL"],
  WITHDRAWN: ["TALENT_POOL", "CLOSED"],
  DO_NOT_CONTACT: [],
};

export const PERSON_PIPELINE_STAGES: Array<{ key: string; label: string; statuses: PersonStatus[] }> = [
  { key: "DISCOVERED", label: "已发现", statuses: [] },
  { key: "REVIEW", label: "待判断", statuses: ["PENDING_REVIEW", "NEEDS_RESEARCH"] },
  { key: "READY", label: "待联系", statuses: ["READY_TO_CONTACT"] },
  { key: "CONTACTED", label: "已联系", statuses: ["CONTACTED"] },
  { key: "ENGAGED", label: "有效沟通", statuses: ["ENGAGED"] },
  { key: "SCREENING", label: "初筛", statuses: ["SCREENING", "CONVERTED"] },
  { key: "INTERVIEW", label: "面试中", statuses: ["INTERVIEWING"] },
  { key: "OFFER", label: "Offer", statuses: ["OFFERED"] },
  { key: "HIRED", label: "已入职", statuses: ["HIRED"] },
];

export const PERSON_OUTCOME_STAGES: Array<{ key: string; label: string; statuses: PersonStatus[] }> = [
  { key: "TALENT_POOL", label: "人才库", statuses: ["TALENT_POOL"] },
  { key: "ENDED", label: "已结束", statuses: ["CLOSED", "WITHDRAWN", "DO_NOT_CONTACT"] },
];

export const terminalReasonStatuses = new Set<PersonStatus>(["TALENT_POOL", "CLOSED", "WITHDRAWN", "DO_NOT_CONTACT"]);

export function isPersonStatus(value: unknown): value is PersonStatus {
  return typeof value === "string" && value in PERSON_STATUS_LABELS;
}

export function canTransitionPersonStatus(from: PersonStatus, to: PersonStatus) {
  return PERSON_STATUS_TRANSITIONS[from].includes(to);
}

export function commonPersonTransitions(statuses: PersonStatus[]) {
  if (!statuses.length) return [];
  return PERSON_STATUS_TRANSITIONS[statuses[0]].filter((candidate) => statuses.every((status) => PERSON_STATUS_TRANSITIONS[status].includes(candidate)));
}
