import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { db, now } from "@/lib/db";
import type { EmploymentRecord, ResumeDocument, ResumeProfile } from "@/lib/types";

type Row = Record<string, string | number | null>;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedExtensions = new Set([".pdf", ".docx", ".txt", ".md"]);

function resumeFrom(row: Row): ResumeDocument {
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
    parseVersion: String(row.parse_version),
    errorMessage: String(row.error_message),
    retentionUntil: row.retention_until ? String(row.retention_until) : null,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    analyzedAt: row.analyzed_at ? String(row.analyzed_at) : null,
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
  if (existing) return { resume: getResume(existing.id)!, duplicate: true };

  const id = randomUUID();
  let storagePath = "";
  if (input.buffer) {
    const storageDirectory = join(process.cwd(), ".data", "resumes");
    mkdirSync(storageDirectory, { recursive: true });
    storagePath = join(storageDirectory, `${id}${extension}`);
    writeFileSync(storagePath, input.buffer, { flag: "wx" });
  }
  const timestamp = now();
  db.prepare(`INSERT INTO resume_documents
    (id, campaign_id, person_id, file_name, mime_type, source_type, legal_basis, storage_path, content_hash, extracted_text, status, parse_version, error_message, retention_until, created_by, created_at, updated_at, analyzed_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '', '', ?, ?, ?, ?, NULL)`)
    .run(id, input.campaignId, input.fileName, input.mimeType, input.sourceType, input.legalBasis.trim(), storagePath, contentHash, extractedText, null, input.createdBy, timestamp, timestamp);
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
    const employments = db.prepare(`SELECT e.*, o.name AS organization_name FROM employments e JOIN organizations o ON o.id = e.organization_id WHERE e.resume_id = ? ORDER BY e.sequence`).all(resume.id) as Row[];
    const skills = db.prepare(`SELECT s.name, s.category, ps.confidence, ps.evidence_text FROM person_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.resume_id = ? ORDER BY ps.confidence DESC, s.name`).all(resume.id) as Row[];
    return {
      ...resume,
      personHeadline: person?.headline || "",
      personLocation: person?.location || "",
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
    return (db.prepare("SELECT id FROM resume_documents WHERE campaign_id = ? AND (status IN ('PENDING','FAILED','NEEDS_REVIEW') OR analyzed_at IS NULL OR updated_at > analyzed_at) ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at").all(campaignId) as Array<{ id: string }>).map((row) => row.id);
  }
  return (db.prepare("SELECT id FROM resume_documents WHERE status IN ('PENDING','FAILED','NEEDS_REVIEW') OR analyzed_at IS NULL OR updated_at > analyzed_at ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at").all() as Array<{ id: string }>).map((row) => row.id);
}
