import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { db, now } from "@/lib/db";
import type { EmploymentRecord, ResumeDocument, ResumeIdentityDecision, ResumeProfile } from "@/lib/types";
import { applicationPath } from "@/lib/runtime-paths";
import { preflightAssessment } from "@/lib/resume-quality";
import { getCandidateAutomationSettings } from "@/lib/settings";
import { recordActivityEvent } from "@/lib/autonomy";

type Row = Record<string, string | number | null>;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedExtensions = new Set([".pdf", ".docx", ".txt", ".md"]);

function resumeFrom(row: Row): ResumeDocument {
  const parsed = <T>(value: string | number | null, fallback: T) => {
    try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
  };
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    campaignName: String(row.campaign_name || ""),
    personId: row.person_id ? String(row.person_id) : null,
    personName: row.person_name ? String(row.person_name) : null,
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sourceType: String(row.source_type),
    legalBasis: String(row.legal_basis),
    contentHash: String(row.content_hash),
    status: row.status as ResumeDocument["status"],
    qualityScore: Number(row.quality_score || 0),
    qualityGrade: String(row.quality_grade || "UNASSESSED") as ResumeDocument["qualityGrade"],
    qualityReasons: parsed<string[]>(row.quality_reasons_json, []),
    qualityMetrics: parsed<ResumeDocument["qualityMetrics"]>(row.quality_metrics_json, {}),
    graphEligible: Boolean(row.graph_eligible),
    searchEligible: Boolean(row.search_eligible),
    qualityAssessedAt: row.quality_assessed_at ? String(row.quality_assessed_at) : null,
    parseVersion: String(row.parse_version),
    errorMessage: String(row.error_message),
    retentionUntil: row.retention_until ? String(row.retention_until) : null,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    analyzedAt: row.analyzed_at ? String(row.analyzed_at) : null,
    sourceSearchTaskId: row.source_search_task_id ? String(row.source_search_task_id) : null,
    sourceStrategyVersionId: row.source_strategy_version_id ? String(row.source_strategy_version_id) : null,
    experimentAssignmentId: row.experiment_assignment_id ? String(row.experiment_assignment_id) : null,
  };
}

export async function extractResumeText(fileName: string, mimeType: string, buffer: Buffer) {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".pdf" || mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }
  if (extension === ".docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
  return buffer.toString("utf8").trim();
}

export async function importResume(input: {
  campaignId: string;
  fileName: string;
  mimeType: string;
  sourceType: string;
  legalBasis: string;
  createdBy: string;
  buffer?: Buffer;
  rawText?: string;
  sourceSearchTaskId?: string | null;
  sourceStrategyVersionId?: string | null;
  experimentAssignmentId?: string | null;
}) {
  if (!input.campaignId) throw new Error("请选择人才画像");
  if (!input.legalBasis.trim()) throw new Error("必须填写简历来源或处理依据");
  const extension = extname(input.fileName).toLowerCase();
  if (input.buffer && (!allowedExtensions.has(extension) || input.buffer.length > MAX_FILE_SIZE)) {
    throw new Error("只支持 10MB 以内的 PDF、DOCX、TXT 或 Markdown 文件");
  }
  const extractedText = input.rawText?.trim() || (input.buffer ? await extractResumeText(input.fileName, input.mimeType, input.buffer) : "");
  if (extractedText.length < 20) throw new Error("简历正文过短或无法解析，请检查文件内容");
  if (extractedText.length > 200_000) throw new Error("简历正文超过 20 万字符，请拆分后导入");
  const contentHash = createHash("sha256").update(extractedText).digest("hex");
  const existing = db.prepare("SELECT id FROM resume_documents WHERE campaign_id = ? AND content_hash = ?").get(input.campaignId, contentHash) as { id: string } | undefined;
  if (existing) {
    if (input.sourceSearchTaskId || input.sourceStrategyVersionId || input.experimentAssignmentId) {
      db.prepare(`UPDATE resume_documents SET source_search_task_id = COALESCE(source_search_task_id, ?),
        source_strategy_version_id = COALESCE(source_strategy_version_id, ?), experiment_assignment_id = COALESCE(experiment_assignment_id, ?) WHERE id = ?`)
        .run(input.sourceSearchTaskId || null, input.sourceStrategyVersionId || null, input.experimentAssignmentId || null, existing.id);
    }
    return { resume: getResume(existing.id)!, duplicate: true };
  }

  const id = randomUUID();
  let storagePath = "";
  if (input.buffer) {
    const storageDirectory = applicationPath(".data", "resumes");
    mkdirSync(storageDirectory, { recursive: true });
    storagePath = join(storageDirectory, `${id}${extension}`);
    writeFileSync(storagePath, input.buffer, { flag: "wx" });
  }
  const timestamp = now();
  const quality = preflightAssessment(extractedText, getCandidateAutomationSettings().resumeQualityPolicy);
  const initialStatus = quality.grade === "QUARANTINED" ? "QUARANTINED" : "PENDING";
  db.prepare(`INSERT INTO resume_documents
    (id, campaign_id, person_id, file_name, mime_type, source_type, legal_basis, storage_path, content_hash, extracted_text, status,
     quality_score, quality_grade, quality_reasons_json, quality_metrics_json, graph_eligible, search_eligible, quality_assessed_at,
     parse_version, error_message, retention_until, created_by, created_at, updated_at, analyzed_at,
     source_search_task_id, source_strategy_version_id, experiment_assignment_id)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, '', '', ?, ?, ?, ?, NULL, ?, ?, ?)`)
    .run(id, input.campaignId, input.fileName, input.mimeType, input.sourceType, input.legalBasis.trim(), storagePath, contentHash, extractedText,
      initialStatus, quality.score, quality.grade, JSON.stringify(quality.reasons), JSON.stringify(quality.metrics), timestamp, null, input.createdBy, timestamp, timestamp,
      input.sourceSearchTaskId || null, input.sourceStrategyVersionId || null, input.experimentAssignmentId || null);
  recordActivityEvent({
    campaignId: input.campaignId,
    resumeId: id,
    searchTaskId: input.sourceSearchTaskId || null,
    strategyVersionId: input.sourceStrategyVersionId || null,
    experimentAssignmentId: input.experimentAssignmentId || null,
    eventType: "RESUME_IMPORTED",
    reasonCode: quality.grade === "QUARANTINED" ? "QUALITY_PREFLIGHT_QUARANTINED" : "AUTHORIZED_IMPORT",
    actorType: input.sourceType === "BOSS_VISIBLE_SCREENSHOT" ? "PLUGIN" : "USER",
    actorId: input.createdBy,
    payload: { sourceType: input.sourceType, qualityScore: quality.score, qualityGrade: quality.grade },
    occurredAt: timestamp,
    idempotencyKey: `resume-imported:${id}`,
  });
  return { resume: getResume(id)!, duplicate: false };
}

export function listResumes(campaignId?: string) {
  const where = campaignId ? "WHERE r.campaign_id = ?" : "";
  return (db.prepare(`SELECT r.*, c.name AS campaign_name, p.name AS person_name
    FROM resume_documents r
    JOIN campaigns c ON c.id = r.campaign_id
    LEFT JOIN people p ON p.id = r.person_id
    ${where}
    ORDER BY r.created_at DESC`).all(...(campaignId ? [campaignId] : [])) as Row[]).map(resumeFrom);
}

export function listResumeProfiles(campaignId?: string): ResumeProfile[] {
  return listResumes(campaignId).map((resume) => {
    const person = resume.personId ? db.prepare("SELECT headline, location FROM people WHERE id = ?").get(resume.personId) as { headline: string; location: string } | undefined : undefined;
    const identity = db.prepare(`SELECT rim.*, matched.name AS matched_person_name
      FROM resume_identity_matches rim
      LEFT JOIN people matched ON matched.id = rim.matched_person_id
      WHERE rim.resume_id = ?`).get(resume.id) as Row | undefined;
    const employments = db.prepare(`SELECT e.*, o.name AS organization_name FROM employments e JOIN organizations o ON o.id = e.organization_id WHERE e.resume_id = ? ORDER BY e.sequence`).all(resume.id) as Row[];
    const skills = db.prepare(`SELECT s.name, s.category, ps.confidence, ps.evidence_text FROM person_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.resume_id = ? ORDER BY ps.confidence DESC, s.name`).all(resume.id) as Row[];
    return {
      ...resume,
      personHeadline: person?.headline || "",
      personLocation: person?.location || "",
      identityDecision: identity ? String(identity.decision) as ResumeIdentityDecision : null,
      identityScore: identity ? Number(identity.score) : null,
      identityConfidence: identity ? Number(identity.confidence) : null,
      identityReasons: identity ? JSON.parse(String(identity.reasons_json)) as string[] : [],
      identityCandidateCount: identity ? Number(identity.candidate_count) : 0,
      identityMatchedPersonId: identity?.matched_person_id ? String(identity.matched_person_id) : null,
      identityMatchedPersonName: identity?.matched_person_name ? String(identity.matched_person_name) : null,
      employments: employments.map((row): EmploymentRecord => ({
        id: String(row.id), personId: String(row.person_id), organizationId: String(row.organization_id), organizationName: String(row.organization_name), rawTitle: String(row.raw_title), normalizedRole: String(row.normalized_role),
        startDate: row.start_date ? String(row.start_date) : null, endDate: row.end_date ? String(row.end_date) : null, isCurrent: Boolean(row.is_current), summary: String(row.summary), confidence: Number(row.confidence),
      })),
      skills: skills.map((row) => ({ name: String(row.name), category: String(row.category), confidence: Number(row.confidence), evidenceText: String(row.evidence_text) })),
    };
  });
}

export function getResume(id: string) {
  const row = db.prepare(`SELECT r.*, c.name AS campaign_name, p.name AS person_name
    FROM resume_documents r
    JOIN campaigns c ON c.id = r.campaign_id
    LEFT JOIN people p ON p.id = r.person_id
    WHERE r.id = ?`).get(id) as Row | undefined;
  return row ? resumeFrom(row) : null;
}

export function getResumeText(id: string) {
  const row = db.prepare("SELECT extracted_text FROM resume_documents WHERE id = ?").get(id) as { extracted_text: string } | undefined;
  return row?.extracted_text || "";
}

export function getPendingResumeIds(campaignId?: string, resumeIds?: string[]) {
  if (resumeIds?.length) {
    const placeholders = resumeIds.map(() => "?").join(",");
    return (db.prepare(`SELECT id FROM resume_documents WHERE id IN (${placeholders}) ORDER BY created_at`).all(...resumeIds) as Array<{ id: string }>).map((row) => row.id);
  }
  if (campaignId) {
    return (db.prepare(`SELECT rd.id FROM resume_documents rd WHERE rd.campaign_id = ?
      AND rd.status <> 'QUARANTINED'
      AND (rd.status IN ('PENDING','FAILED') OR rd.analyzed_at IS NULL OR rd.updated_at > rd.analyzed_at)
      AND NOT EXISTS (SELECT 1 FROM campaign_people cp WHERE cp.campaign_id = rd.campaign_id AND cp.person_id = rd.person_id AND cp.status NOT IN ('PENDING_REVIEW','NEEDS_RESEARCH'))
      ORDER BY CASE rd.status WHEN 'PENDING' THEN 0 ELSE 1 END, rd.created_at`).all(campaignId) as Array<{ id: string }>).map((row) => row.id);
  }
  return (db.prepare(`SELECT rd.id FROM resume_documents rd
    WHERE rd.status <> 'QUARANTINED' AND (rd.status IN ('PENDING','FAILED') OR rd.analyzed_at IS NULL OR rd.updated_at > rd.analyzed_at)
    AND NOT EXISTS (SELECT 1 FROM campaign_people cp WHERE cp.campaign_id = rd.campaign_id AND cp.person_id = rd.person_id AND cp.status NOT IN ('PENDING_REVIEW','NEEDS_RESEARCH'))
    ORDER BY CASE rd.status WHEN 'PENDING' THEN 0 ELSE 1 END, rd.created_at`).all() as Array<{ id: string }>).map((row) => row.id);
}

export function latestResumeQualityReview(resumeId: string) {
  const row = db.prepare(`SELECT decision, note, actor_id, created_at FROM resume_quality_reviews
    WHERE resume_id = ? ORDER BY created_at DESC LIMIT 1`).get(resumeId) as Row | undefined;
  return row ? {
    decision: String(row.decision) as "RESTORED" | "CONFIRMED",
    note: String(row.note || ""),
    actorId: String(row.actor_id),
    createdAt: String(row.created_at),
  } : null;
}

export function isResumeQualityRestored(resumeId: string) {
  return latestResumeQualityReview(resumeId)?.decision === "RESTORED";
}

export function reviewResumeQuality(input: { resumeId: string; decision: "RESTORED" | "CONFIRMED"; note?: string; actorId: string }) {
  const resume = db.prepare("SELECT id, campaign_id, status FROM resume_documents WHERE id = ?").get(input.resumeId) as Row | undefined;
  if (!resume) throw new Error("简历不存在");
  if (resume.status !== "QUARANTINED") throw new Error("仅质量隔离中的简历可以执行此复核");
  const timestamp = now();
  const reviewId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO resume_quality_reviews (id, resume_id, campaign_id, decision, note, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(reviewId, input.resumeId, String(resume.campaign_id), input.decision, input.note?.trim().slice(0, 500) || "", input.actorId, timestamp);
    if (input.decision === "RESTORED") {
      db.prepare("UPDATE resume_documents SET status = 'PENDING', updated_at = ?, error_message = '' WHERE id = ?").run(timestamp, input.resumeId);
    }
    recordActivityEvent({
      campaignId: String(resume.campaign_id), resumeId: input.resumeId,
      eventType: input.decision === "RESTORED" ? "RESUME_QUALITY_RESTORED" : "RESUME_QUARANTINE_CONFIRMED",
      reasonCode: input.decision === "RESTORED" ? "HUMAN_FALSE_POSITIVE_REVIEW" : "HUMAN_QUARANTINE_CONFIRMED",
      actorType: "USER", actorId: input.actorId, payload: { note: input.note?.trim().slice(0, 500) || "" },
      occurredAt: timestamp, idempotencyKey: `resume-quality-review:${reviewId}`,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id: reviewId, resumeId: input.resumeId, decision: input.decision, status: input.decision === "RESTORED" ? "PENDING" : "QUARANTINED", createdAt: timestamp };
}
