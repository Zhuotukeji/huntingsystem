import { db } from "@/lib/db";
import type { ResumeAnalysis } from "@/lib/llm";
import type { ResumeIdentityDecision } from "@/lib/types";

type PersonRow = {
  id: string;
  name: string;
  headline: string;
  location: string;
};

type EmploymentRow = {
  id: string;
  person_id: string;
  organization_name: string;
  raw_title: string;
  normalized_role: string;
  start_date: string | null;
  end_date: string | null;
  is_current: number;
};

type SkillRow = { person_id: string; normalized_name: string };

export type ResumeIdentityResolution = {
  decision: ResumeIdentityDecision;
  personId: string | null;
  personName: string | null;
  score: number;
  confidence: number;
  reasons: string[];
  candidateCount: number;
};

const maskPattern = /[*＊xX×某]/;

function compact(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s·•.,，。:：;；()（）\[\]【】_-]/g, "");
}

function normalizedName(value: string) {
  return compact(value).replace(/^(姓名|候选人)/, "");
}

function normalizedCompany(value: string) {
  return compact(value).replace(/(有限责任公司|股份有限公司|有限公司)$/g, "");
}

function normalizedRole(value: string) {
  return compact(value).replace(/^(高级|资深|高级资深|初级)/, "");
}

function genericName(value: string) {
  return !value || /^(候选人|未知|未命名候选人|匿名|boss候选人)$/.test(value);
}

export function isMaskedResumeName(value: string) {
  const name = normalizedName(value);
  return genericName(name) || maskPattern.test(name);
}

function maskedPatternMatches(maskedValue: string, plainValue: string) {
  const masked = normalizedName(maskedValue);
  const plain = normalizedName(plainValue);
  if (genericName(masked)) return true;
  const expression = [...masked].map((character) => maskPattern.test(character) ? "." : character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${expression}$`, "u").test(plain);
}

function nameRelation(incomingValue: string, existingValue: string): "EXACT" | "COMPATIBLE" | "UNKNOWN" | "CONFLICT" {
  const incoming = normalizedName(incomingValue);
  const existing = normalizedName(existingValue);
  if (genericName(incoming) || genericName(existing)) return "UNKNOWN";
  const incomingMasked = isMaskedResumeName(incoming);
  const existingMasked = isMaskedResumeName(existing);
  if (!incomingMasked && !existingMasked) return incoming === existing ? "EXACT" : "CONFLICT";
  if (incoming === existing) return "COMPATIBLE";
  if (incomingMasked && !existingMasked) return maskedPatternMatches(incoming, existing) ? "COMPATIBLE" : "CONFLICT";
  if (!incomingMasked && existingMasked) return maskedPatternMatches(existing, incoming) ? "COMPATIBLE" : "CONFLICT";
  const incomingVisible = [...incoming].filter((character) => !maskPattern.test(character)).join("");
  const existingVisible = [...existing].filter((character) => !maskPattern.test(character)).join("");
  if (!incomingVisible || !existingVisible) return "UNKNOWN";
  return incomingVisible === existingVisible || incomingVisible.startsWith(existingVisible) || existingVisible.startsWith(incomingVisible) ? "COMPATIBLE" : "CONFLICT";
}

export function preferredCandidateName(existingValue: string, incomingValue: string) {
  const existing = existingValue.trim();
  const incoming = incomingValue.trim();
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (isMaskedResumeName(existing) && !isMaskedResumeName(incoming)) return incoming;
  if (!isMaskedResumeName(existing) && isMaskedResumeName(incoming)) return existing;
  return existing;
}

function normalizedDate(value: string | null, isCurrent = false) {
  if (isCurrent || /至今|present|current/i.test(value || "")) return "PRESENT";
  const match = String(value || "").match(/(19|20)\d{2}(?:\D{0,3}(\d{1,2}))?/);
  if (!match) return "";
  return match[2] ? `${match[0].slice(0, 4)}-${String(Number(match[2])).padStart(2, "0")}` : match[0].slice(0, 4);
}

function datePoints(left: string | null, right: string | null, leftCurrent = false, rightCurrent = false) {
  const leftDate = normalizedDate(left, leftCurrent);
  const rightDate = normalizedDate(right, rightCurrent);
  if (!leftDate || !rightDate) return 0;
  if (leftDate === rightDate) return 7;
  return leftDate.slice(0, 4) === rightDate.slice(0, 4) ? 4 : 0;
}

function rolePoints(leftValue: string, rightValue: string) {
  const left = normalizedRole(leftValue);
  const right = normalizedRole(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 14;
  if (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left))) return 8;
  return 0;
}

function phraseMatches(leftValue: string, rightValue: string) {
  const left = normalizedRole(leftValue);
  const right = normalizedRole(rightValue);
  return Boolean(left && right && (left === right || (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left)))));
}

function scoreEmployment(
  incoming: ResumeAnalysis["employments"][number],
  existing: EmploymentRow,
) {
  const companyKeys = [incoming.company, ...incoming.aliases].map(normalizedCompany).filter(Boolean);
  if (!companyKeys.includes(normalizedCompany(existing.organization_name))) return null;
  const titlePoints = rolePoints(incoming.normalizedRole || incoming.title, existing.normalized_role || existing.raw_title);
  if (!titlePoints) return null;
  const startPoints = datePoints(incoming.startDate, existing.start_date);
  const endPoints = datePoints(incoming.endDate, existing.end_date, incoming.isCurrent, Boolean(existing.is_current));
  return {
    employmentId: existing.id,
    points: 22 + titlePoints + startPoints + endPoints,
    strong: startPoints > 0 || endPoints > 0,
    company: incoming.company,
    title: incoming.title,
  };
}

function candidateScore(
  analysis: ResumeAnalysis,
  candidate: PersonRow,
  employments: EmploymentRow[],
  skills: Set<string>,
) {
  const relation = nameRelation(analysis.person.name, candidate.name);
  if (relation === "CONFLICT") return null;
  let score = relation === "EXACT" ? 28 : relation === "COMPATIBLE" ? 6 : 0;
  const reasons: string[] = [];
  if (relation === "EXACT") reasons.push("姓名完全一致");
  else if (relation === "COMPATIBLE") reasons.push("脱敏姓名模式兼容");

  const usedEmployments = new Set<string>();
  let employmentMatches = 0;
  let strongEmploymentMatches = 0;
  let employmentScore = 0;
  for (const incoming of analysis.employments) {
    const best = employments
      .filter((employment) => !usedEmployments.has(employment.id))
      .map((employment) => scoreEmployment(incoming, employment))
      .filter((match): match is NonNullable<typeof match> => Boolean(match))
      .sort((left, right) => right.points - left.points)[0];
    if (!best) continue;
    usedEmployments.add(best.employmentId);
    employmentMatches += 1;
    if (best.strong) strongEmploymentMatches += 1;
    employmentScore += best.points;
  }
  score += Math.min(60, employmentScore);
  if (employmentMatches) reasons.push(`${employmentMatches} 段公司与岗位履历一致${strongEmploymentMatches ? `，其中 ${strongEmploymentMatches} 段时间线一致` : ""}`);

  if (phraseMatches(analysis.person.headline, candidate.headline)) {
    score += 6;
    reasons.push("当前职位方向一致");
  }
  if (compact(analysis.person.location) && compact(analysis.person.location) === compact(candidate.location)) {
    score += 4;
    reasons.push("所在地一致");
  }
  const incomingSkills = new Set(analysis.skills.map((skill) => compact(skill.name)).filter(Boolean));
  const skillOverlap = [...incomingSkills].filter((skill) => skills.has(skill)).length;
  if (skillOverlap >= 2) {
    score += Math.min(10, 2 + skillOverlap * 2);
    reasons.push(`${skillOverlap} 项技能证据重合`);
  }

  return {
    candidate,
    score: Math.min(100, score),
    reasons: reasons.slice(0, 5),
    relation,
    employmentMatches,
    strongEmploymentMatches,
    skillOverlap,
  };
}

export function resolveResumeIdentity(resumeId: string, analysis: ResumeAnalysis): ResumeIdentityResolution {
  const fullName = normalizedName(analysis.person.name);
  const companyKeys = [...new Set(analysis.employments.flatMap((employment) => [employment.company, ...employment.aliases]).map(normalizedCompany).filter(Boolean))];
  const conditions: string[] = [];
  const values: string[] = [resumeId];
  if (!isMaskedResumeName(fullName)) {
    conditions.push("p.normalized_name = ?");
    values.push(fullName);
  }
  if (companyKeys.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM employments e
      JOIN organizations o ON o.id = e.organization_id
      WHERE e.person_id = p.id AND o.normalized_name IN (${companyKeys.map(() => "?").join(",")})
    )`);
    values.push(...companyKeys);
  }
  if (!conditions.length) {
    return { decision: "NEW_PROFILE", personId: null, personName: null, score: 0, confidence: 0.86, reasons: ["没有足够履历字段用于检索现有档案"], candidateCount: 0 };
  }

  const candidates = db.prepare(`SELECT p.id, p.name, p.headline, p.location
    FROM people p
    WHERE EXISTS (SELECT 1 FROM resume_documents r WHERE r.person_id = p.id AND r.id <> ?)
      AND (${conditions.join(" OR ")})
    ORDER BY p.created_at DESC
    LIMIT 200`).all(...values) as PersonRow[];
  if (!candidates.length) {
    return { decision: "NEW_PROFILE", personId: null, personName: null, score: 0, confidence: 0.86, reasons: ["未检索到具有相同姓名或任职公司的现有档案"], candidateCount: 0 };
  }

  const placeholders = candidates.map(() => "?").join(",");
  const candidateIds = candidates.map((candidate) => candidate.id);
  const employmentRows = db.prepare(`SELECT e.id, e.person_id, o.name AS organization_name, e.raw_title, e.normalized_role, e.start_date, e.end_date, e.is_current
    FROM employments e JOIN organizations o ON o.id = e.organization_id
    WHERE e.person_id IN (${placeholders})`).all(...candidateIds) as EmploymentRow[];
  const skillRows = db.prepare(`SELECT DISTINCT ps.person_id, s.normalized_name
    FROM person_skills ps JOIN skills s ON s.id = ps.skill_id
    WHERE ps.person_id IN (${placeholders})`).all(...candidateIds) as SkillRow[];
  const scored = candidates
    .map((candidate) => candidateScore(
      analysis,
      candidate,
      employmentRows.filter((employment) => employment.person_id === candidate.id),
      new Set(skillRows.filter((skill) => skill.person_id === candidate.id).map((skill) => compact(skill.normalized_name))),
    ))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.score - left.score);
  const plausible = scored.filter((candidate) => candidate.score >= 50);
  const best = scored[0];
  if (!best || best.score < 50) {
    return { decision: "NEW_PROFILE", personId: null, personName: null, score: best?.score || 0, confidence: 0.86, reasons: ["现有档案缺少足够一致的履历证据"], candidateCount: plausible.length };
  }

  const secondScore = scored[1]?.score || 0;
  const clearMargin = best.score - secondScore >= 12 || secondScore < 50;
  const exactNameEligible = best.relation === "EXACT" && (best.strongEmploymentMatches >= 1 || best.employmentMatches >= 2);
  const maskedNameEligible = best.relation === "COMPATIBLE" && best.employmentMatches >= 2 && (best.strongEmploymentMatches >= 1 || best.skillOverlap >= 3);
  const anonymousEligible = best.relation === "UNKNOWN" && best.strongEmploymentMatches >= 2;
  const autoMerge = best.score >= 72 && clearMargin && (exactNameEligible || maskedNameEligible || anonymousEligible);
  if (autoMerge) {
    return {
      decision: "AUTO_MERGED",
      personId: best.candidate.id,
      personName: best.candidate.name,
      score: best.score,
      confidence: Math.min(0.99, Math.max(0.72, best.score / 100)),
      reasons: [`匹配到现有人选 ${best.candidate.name}`, ...best.reasons].slice(0, 6),
      candidateCount: plausible.length,
    };
  }
  return {
    decision: "REVIEW_REQUIRED",
    personId: best.candidate.id,
    personName: best.candidate.name,
    score: best.score,
    confidence: Math.min(0.79, Math.max(0.5, best.score / 100)),
    reasons: [`发现近似档案 ${best.candidate.name}，因证据或分差不足未自动合并`, ...best.reasons].slice(0, 6),
    candidateCount: plausible.length || 1,
  };
}
