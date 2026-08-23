import type { ResumeAnalysis } from "@/lib/llm";
import type { ResumeQualityGrade, ResumeQualityPolicy } from "@/lib/types";

export interface ResumeQualityAssessment {
  score: number;
  grade: ResumeQualityGrade;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
  graphEligible: boolean;
  searchEligible: boolean;
}

export interface EvaluatedResumeAnalysis {
  analysis: ResumeAnalysis;
  assessment: ResumeQualityAssessment;
}

function bounded(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedEvidence(value: string) {
  return value.toLowerCase().replace(/[\s·•.,，。:：;；()（）\[\]【】_\-/|]/g, "");
}

function contentRatio(value: string) {
  if (!value.length) return 0;
  return (value.match(/[\p{L}\p{N}]/gu)?.length || 0) / value.length;
}

export function isResumeClaimSupported(value: string, resumeText: string) {
  const claim = normalizedEvidence(value);
  if (claim.length < 2) return false;
  return normalizedEvidence(resumeText).includes(claim);
}

export function assessResumeTextPreflight(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const uniqueLines = new Set(lines.map(normalizedEvidence).filter(Boolean));
  const uniqueLineRatio = lines.length ? uniqueLines.size / lines.length : 0;
  const mojibakeCount = (text.match(/[�]|(?:锟斤拷)|(?:鈥)|(?:銆)/g) || []).length;
  const mojibakeRatio = text.length ? mojibakeCount / text.length : 0;
  const hasName = /(?:姓名|name)\s*[：:]/i.test(text) || /^[\u3400-\u9fff]{2,4}\s*$/m.test(text);
  const hasRole = /(?:职位|岗位|职务|title|headline)\s*[：:]/i.test(text) || /(负责人|总监|经理|主管|工程师|专员|顾问|leader|manager|director|engineer)/i.test(text);
  const hasEmploymentDate = /(?:19|20)\d{2}[.年/\-]?\d{0,2}\s*(?:-|—|至|~|～)\s*(?:(?:19|20)\d{2}|至今|现在|present)/i.test(text);
  const hasCompany = /(公司|集团|工作经历|任职经历|employment|experience|\binc\b|\bltd\b|\bcorp\b)/i.test(text);
  const hasSupportingSection = /(技能|项目|业绩|教育|能力|skills|project|achievement|education)/i.test(text);
  const jdSignals = (text.match(/岗位职责|任职要求|职位描述|薪资待遇|招聘人数|投递简历/g) || []).length;

  let score = text.length >= 1_000 ? 20 : text.length >= 400 ? 18 : text.length >= 160 ? 15 : text.length >= 80 ? 10 : 4;
  score += lines.length >= 8 ? 10 : lines.length >= 4 ? 7 : 2;
  score += hasName ? 8 : 0;
  score += hasRole ? 8 : 0;
  score += hasEmploymentDate ? 18 : 0;
  score += hasCompany ? 12 : 0;
  score += hasSupportingSection ? 10 : 0;
  score += contentRatio(text) >= 0.55 ? 8 : contentRatio(text) >= 0.4 ? 4 : 0;
  score += uniqueLineRatio >= 0.8 ? 6 : uniqueLineRatio >= 0.55 ? 3 : 0;
  if (jdSignals >= 2 && !hasName) score -= 25;
  if (uniqueLineRatio < 0.45 && lines.length >= 6) score -= 20;
  if (mojibakeRatio > 0.015) score -= 25;

  const reasons: string[] = [];
  if (!hasName) reasons.push("缺少可识别的候选人姓名");
  if (!hasRole) reasons.push("缺少明确职位或职业方向");
  if (!hasEmploymentDate) reasons.push("缺少可验证的任职时间段");
  if (!hasCompany) reasons.push("缺少明确公司或任职经历");
  if (jdSignals >= 2 && !hasName) reasons.push("内容更像职位描述或招聘广告");
  if (uniqueLineRatio < 0.45 && lines.length >= 6) reasons.push("正文存在大量重复内容");
  if (mojibakeRatio > 0.015) reasons.push("正文存在较多乱码或解析错误");

  return {
    score: Math.round(bounded(score)),
    reasons,
    metrics: {
      textLength: text.length,
      lineCount: lines.length,
      uniqueLineRatio: Number(uniqueLineRatio.toFixed(3)),
      contentRatio: Number(contentRatio(text).toFixed(3)),
      mojibakeRatio: Number(mojibakeRatio.toFixed(4)),
      hasName,
      hasRole,
      hasEmploymentDate,
      hasCompany,
      looksLikeJobDescription: jdSignals >= 2 && !hasName,
    },
  };
}

function supportedList(values: string[], text: string, limit: number) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value && isResumeClaimSupported(value, text)))].slice(0, limit);
}

export function evaluateResumeQuality(text: string, source: ResumeAnalysis, policy: ResumeQualityPolicy): EvaluatedResumeAnalysis {
  const preflight = assessResumeTextPreflight(text);
  const rawEmploymentCount = source.employments.length;
  const rawSkillCount = source.skills.length;
  let droppedUnsupportedClaims = 0;

  const employments = source.employments.slice(0, policy.maxOrganizationsPerResume).flatMap((employment) => {
    const quoteSupported = isResumeClaimSupported(employment.evidenceQuote, text);
    const companySupported = isResumeClaimSupported(employment.company, text);
    const titleSupported = isResumeClaimSupported(employment.title, text);
    if (!quoteSupported || !companySupported || !titleSupported || employment.confidence < 0.55) {
      droppedUnsupportedClaims += 1;
      return [];
    }
    const businessTags = supportedList(employment.businessTags, text, 10);
    const markets = supportedList(employment.markets, text, 8);
    const channels = supportedList(employment.channels, text, 8);
    const monetization = supportedList(employment.monetization, text, 6);
    const businessHistory = supportedList(employment.businessHistory, text, 8);
    const currentBusiness = supportedList(employment.currentBusiness, text, 8);
    const businessSignals = supportedList(employment.businessSignals, text, 8);
    const aliases = supportedList(employment.aliases, text, 5);
    const industry = employment.industry && isResumeClaimSupported(employment.industry, text) ? employment.industry : "";
    droppedUnsupportedClaims += employment.businessTags.length - businessTags.length;
    droppedUnsupportedClaims += employment.markets.length - markets.length;
    droppedUnsupportedClaims += employment.channels.length - channels.length;
    droppedUnsupportedClaims += employment.monetization.length - monetization.length;
    droppedUnsupportedClaims += employment.businessHistory.length - businessHistory.length;
    droppedUnsupportedClaims += employment.currentBusiness.length - currentBusiness.length;
    droppedUnsupportedClaims += employment.businessSignals.length - businessSignals.length;
    const businessStatus = businessSignals.length && employment.businessStatusConfidence >= 0.65 ? employment.businessStatus : "UNKNOWN";
    return [{
      ...employment,
      aliases,
      industry,
      businessTags,
      markets,
      channels,
      monetization,
      businessHistory,
      currentBusiness,
      businessSignals,
      businessStatus,
      businessStatusSummary: businessStatus === "UNKNOWN" ? "简历未提供足够的可验证经营信号，暂不判断业务状态。" : employment.businessStatusSummary,
      businessStatusConfidence: businessStatus === "UNKNOWN" ? 0 : employment.businessStatusConfidence,
      summary: isResumeClaimSupported(employment.summary, text) ? employment.summary : employment.evidenceQuote,
    }];
  });

  const skills = source.skills.slice(0, policy.maxSkillsPerResume).filter((skill) => {
    const supported = skill.confidence >= 0.55 && isResumeClaimSupported(skill.name, text) && isResumeClaimSupported(skill.evidence, text);
    if (!supported) droppedUnsupportedClaims += 1;
    return supported;
  });
  droppedUnsupportedClaims += Math.max(0, rawEmploymentCount - policy.maxOrganizationsPerResume);
  droppedUnsupportedClaims += Math.max(0, rawSkillCount - policy.maxSkillsPerResume);

  const personCompleteness = (source.person.name.trim() ? 5 : 0) + (source.person.headline.trim() ? 3 : 0) + (source.person.location.trim() ? 2 : 0);
  const employmentCompleteness = employments.length
    ? Math.min(25, 15 + Math.min(employments.length, 3) * 3 + (employments.some((item) => item.isCurrent) ? 1 : 0))
    : 0;
  const groundedClaims = employments.length + skills.length;
  const rawClaims = Math.max(1, rawEmploymentCount + rawSkillCount);
  const groundingRatio = groundedClaims / rawClaims;
  const evidenceScore = Math.round(Math.min(15, groundingRatio * 15));
  const chronologyScore = employments.some((item) => item.startDate || item.endDate || item.isCurrent) ? 5 : 0;
  const usefulSignals = skills.length + employments.flatMap((item) => [...item.businessTags, ...item.markets, ...item.channels]).length;
  const signalScore = Math.min(5, usefulSignals);
  const score = Math.round(bounded(preflight.score * 0.4 + personCompleteness + employmentCompleteness + evidenceScore + chronologyScore + signalScore));
  const graphEligible = score >= policy.graphMinimumScore && employments.length > 0;
  const searchEligible = graphEligible && score >= policy.highConfidenceMinimumScore;
  const grade: ResumeQualityGrade = score < policy.quarantineBelow
    ? "QUARANTINED"
    : !graphEligible
      ? "NEEDS_REVIEW"
      : searchEligible
        ? "HIGH_CONFIDENCE"
        : "GRAPH_ELIGIBLE";
  const reasons = [...preflight.reasons];
  if (!employments.length) reasons.push("没有任职记录同时满足公司、职位和原文引用校验");
  if (groundingRatio < 0.7) reasons.push("部分 AI 抽取结果无法在简历原文中定位");
  if (rawEmploymentCount > policy.maxOrganizationsPerResume) reasons.push(`任职公司超过单份简历上限 ${policy.maxOrganizationsPerResume} 家`);
  if (rawSkillCount > policy.maxSkillsPerResume) reasons.push(`技能数量超过单份简历上限 ${policy.maxSkillsPerResume} 项`);
  if (graphEligible && !searchEligible) reasons.push("允许进入图谱，但不足以自动推进或驱动反向搜索");
  if (!reasons.length) reasons.push("结构完整，核心任职和技能均可回溯到原文");

  return {
    analysis: { ...source, employments, skills },
    assessment: {
      score,
      grade,
      reasons: [...new Set(reasons)].slice(0, 12),
      graphEligible,
      searchEligible,
      metrics: {
        ...preflight.metrics,
        preflightScore: preflight.score,
        rawEmploymentCount,
        acceptedEmploymentCount: employments.length,
        rawSkillCount,
        acceptedSkillCount: skills.length,
        groundingRatio: Number(groundingRatio.toFixed(3)),
        droppedUnsupportedClaims,
      },
    },
  };
}

export function preflightAssessment(text: string, policy: ResumeQualityPolicy): ResumeQualityAssessment {
  const preflight = assessResumeTextPreflight(text);
  const quarantined = preflight.score < policy.quarantineBelow;
  return {
    score: preflight.score,
    grade: quarantined ? "QUARANTINED" : "PREFLIGHT",
    reasons: preflight.reasons.length ? preflight.reasons : ["基础结构检查通过，等待 AI 逐条验证"],
    metrics: { ...preflight.metrics, preflightScore: preflight.score },
    graphEligible: false,
    searchEligible: false,
  };
}
