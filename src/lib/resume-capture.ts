import { createHash } from "node:crypto";
import { createAiRun } from "@/lib/learning";
import { importResume } from "@/lib/resumes";

export type CapturedResumeSegment = {
  sequence: number;
  screenshotHash: string;
  pageUrl: string;
  synthetic: boolean;
  candidateName: string;
  headline: string;
  visibleSection: string;
  text: string;
  hasMoreBelow: boolean;
  warnings: string[];
};

function normalizedLine(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s|｜·•,，。:：;；()（）\[\]【】_-]/g, "");
}

function normalizedName(value: string) {
  return normalizedLine(value).replace(/^(姓名|候选人)/, "");
}

function normalizedPageUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function lineContainsSensitiveData(line: string) {
  const compact = line.replace(/\s/g, "");
  return /^(手机|手机号|联系电话|电话|联系方式|邮箱|电子邮箱|email|e-mail|微信|微信号|wechat|身份证|身份证号|证件号|年龄|性别|婚姻|婚育|政治面貌)(?:[：:]|$)/i.test(compact)
    || /^(男|女)(?:$|[|｜,，·•])/.test(compact)
    || /(?:^|[|｜,，·•])\d{1,2}岁(?:$|[|｜,，·•])/.test(compact)
    || /(?:^|[|｜,，·•])(已婚|未婚|已育|未育)(?:$|[|｜,，·•])/.test(compact)
    || /(?:1[3-9]\d{9})/.test(compact)
    || /(?:\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])/.test(compact)
    || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(line);
}

export function sanitizeCapturedText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !lineContainsSensitiveData(line))
    .join("\n");
}

export function hasUsableResumeDetailEvidence(input: {
  isResumeDetail: boolean;
  sequence: number;
  candidateName: string;
  expectedCandidateName: string;
  headline: string;
  text: string;
}) {
  if (input.isResumeDetail) return true;
  if (input.sequence === 1) {
    return Boolean(input.candidateName.trim() && (input.headline.trim() || input.text.trim().length >= 80));
  }
  return Boolean(input.expectedCandidateName.trim() && input.text.trim().length >= 40);
}

function containsLineSequence(haystack: string[], needle: string[]) {
  if (!needle.length || needle.length > haystack.length) return false;
  const normalizedHaystack = haystack.map(normalizedLine);
  const normalizedNeedle = needle.map(normalizedLine);
  for (let index = 0; index <= normalizedHaystack.length - normalizedNeedle.length; index += 1) {
    if (normalizedNeedle.every((line, offset) => line === normalizedHaystack[index + offset])) return true;
  }
  return false;
}

function adjacentOverlap(left: string[], right: string[]) {
  const maximum = Math.min(left.length, right.length, 30);
  for (let size = maximum; size > 0; size -= 1) {
    const leftSuffix = left.slice(-size).map(normalizedLine);
    const rightPrefix = right.slice(0, size).map(normalizedLine);
    if (leftSuffix.every((line, index) => line === rightPrefix[index])) return size;
  }
  return 0;
}

export function mergeResumeCaptureSegments(segments: CapturedResumeSegment[]) {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 10) throw new Error("每份简历需采集 1 至 10 屏");
  const ordered = [...segments].sort((left, right) => left.sequence - right.sequence);
  const hashes = new Set<string>();
  const names = new Map<string, string>();
  const urls = new Set<string>();
  let mergedLines: string[] = [];

  ordered.forEach((segment, index) => {
    if (!Number.isInteger(segment.sequence) || segment.sequence < 1 || segment.sequence > 10) throw new Error("截图序号无效");
    if (segment.sequence !== index + 1) throw new Error("截图序号必须从 1 开始连续排列");
    if (!/^[a-f0-9]{64}$/i.test(segment.screenshotHash)) throw new Error("截图校验值无效");
    if (hashes.has(segment.screenshotHash)) throw new Error("检测到重复截图，请滚动后再采集");
    hashes.add(segment.screenshotHash);
    try { urls.add(normalizedPageUrl(segment.pageUrl)); } catch { throw new Error("无法确认截图页面来源"); }
    const name = segment.candidateName.trim();
    if (name) names.set(normalizedName(name), name);
    const text = sanitizeCapturedText(segment.text);
    const lines = text.split("\n").filter(Boolean);
    if (!lines.length) return;
    if (containsLineSequence(mergedLines, lines)) return;
    const overlap = adjacentOverlap(mergedLines, lines);
    mergedLines.push(...lines.slice(overlap));
  });

  if (urls.size !== 1) throw new Error("多屏截图必须来自同一个候选人详情页");
  if (!ordered[0].candidateName.trim()) throw new Error("第一屏缺少候选人姓名，请从简历顶部重新采集");
  if (names.size > 1) throw new Error(`不同截图中的候选人姓名不一致：${[...names.values()].join("、")}`);
  const candidateName = [...names.values()][0] || "";
  const headline = ordered.map((segment) => sanitizeCapturedText(segment.headline)).find(Boolean) || "";
  const prefixes: string[] = [];
  if (candidateName && !mergedLines.some((line) => normalizedLine(line) === normalizedLine(`姓名：${candidateName}`))) prefixes.push(`姓名：${candidateName}`);
  if (headline && !mergedLines.some((line) => normalizedLine(line) === normalizedLine(`职位：${headline}`))) prefixes.push(`职位：${headline}`);
  mergedLines = [...prefixes, ...mergedLines];
  const text = mergedLines.join("\n").trim();
  if (text.length < 20) throw new Error("识别出的简历内容过短，请重新采集清晰页面");
  if (text.length > 80_000) throw new Error("合并后的简历超过 8 万字符，请减少截图后重试");
  return { text, candidateName, headline, screenCount: ordered.length };
}

export function screenshotHash(imageDataUrl: string) {
  return createHash("sha256").update(imageDataUrl).digest("hex");
}

export async function finalizeResumeCapture(input: {
  campaignId: string;
  legalBasis: string;
  createdBy: string;
  segments: CapturedResumeSegment[];
}) {
  const merged = mergeResumeCaptureSegments(input.segments);
  const date = new Date().toISOString().slice(0, 10);
  const safeName = (merged.candidateName || "未命名候选人").replace(/[\\/:*?"<>|]/g, "-");
  const result = await importResume({
    campaignId: input.campaignId,
    fileName: `BOSS截图-${safeName}-${date}.txt`,
    mimeType: "text/plain",
    sourceType: "BOSS_VISIBLE_SCREENSHOT",
    legalBasis: input.legalBasis,
    createdBy: input.createdBy,
    rawText: merged.text,
  });
  const aiRun = result.duplicate ? null : createAiRun({
    campaignId: result.resume.campaignId,
    runType: "UPLOAD",
    resumeIds: [result.resume.id],
    triggeredBy: `Chrome 插件截图采集 · ${input.createdBy}`,
  });
  return { ...result, aiRun, merged: { candidateName: merged.candidateName, headline: merged.headline, screenCount: merged.screenCount } };
}
