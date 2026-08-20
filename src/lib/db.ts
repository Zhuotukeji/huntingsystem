import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.DATABASE_PATH || join(process.cwd(), ".data", "hunting.db");
mkdirSync(dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & { huntingDb?: DatabaseSync };

export const db = globalDatabase.huntingDb ?? new DatabaseSync(databasePath);

if (process.env.NODE_ENV !== "production") {
  globalDatabase.huntingDb = db;
}

db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role_name TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      business_goal TEXT NOT NULL,
      value_proposition TEXT NOT NULL,
      locations_json TEXT NOT NULL,
      markets_json TEXT NOT NULL,
      channels_json TEXT NOT NULL,
      must_haves_json TEXT NOT NULL,
      nice_to_haves_json TEXT NOT NULL,
      exclusions_json TEXT NOT NULL,
      target_organization_count INTEGER NOT NULL,
      target_person_count INTEGER NOT NULL,
      weekly_target INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      location TEXT NOT NULL,
      size TEXT NOT NULL,
      description TEXT NOT NULL,
      identity_confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(normalized_name, domain)
    );

    CREATE TABLE IF NOT EXISTS campaign_organizations (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      products_json TEXT NOT NULL,
      markets_json TEXT NOT NULL,
      channels_json TEXT NOT NULL,
      monetization_json TEXT NOT NULL,
      fit_score INTEGER NOT NULL,
      evidence_coverage INTEGER NOT NULL,
      confidence INTEGER NOT NULL,
      recommendation_reason TEXT NOT NULL,
      unknowns_json TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      review_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(campaign_id, organization_id)
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      headline TEXT NOT NULL,
      location TEXT NOT NULL,
      identity_confidence REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_people (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      slot TEXT NOT NULL,
      status TEXT NOT NULL,
      fit_score INTEGER NOT NULL,
      evidence_coverage INTEGER NOT NULL,
      identity_confidence INTEGER NOT NULL,
      recommendation_reason TEXT NOT NULL,
      strengths_json TEXT NOT NULL,
      unknowns_json TEXT NOT NULL,
      risk_flags_json TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      review_reason TEXT NOT NULL DEFAULT '',
      last_interaction_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(campaign_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      classification TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      quote TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_provider TEXT NOT NULL,
      confidence REAL NOT NULL,
      observed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      model_name TEXT NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      imported_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(provider, content_hash)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      note TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_versions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      criteria_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(campaign_id, version)
    );

    CREATE TABLE IF NOT EXISTS resume_documents (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      legal_basis TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      status TEXT NOT NULL,
      parse_version TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      retention_until TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      analyzed_at TEXT,
      UNIQUE(campaign_id, content_hash)
    );

    CREATE TABLE IF NOT EXISTS employments (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      resume_id TEXT NOT NULL REFERENCES resume_documents(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      raw_company_name TEXT NOT NULL,
      raw_title TEXT NOT NULL,
      normalized_role TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      is_current INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(resume_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_skills (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL REFERENCES skills(id),
      resume_id TEXT NOT NULL REFERENCES resume_documents(id) ON DELETE CASCADE,
      confidence REAL NOT NULL,
      evidence_text TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(person_id, skill_id, resume_id)
    );

    CREATE TABLE IF NOT EXISTS organization_facts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      value_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_resume_id TEXT REFERENCES resume_documents(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(organization_id, field_name, value_json, source_resume_id)
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      weight REAL NOT NULL,
      confidence REAL NOT NULL,
      source_resume_id TEXT REFERENCES resume_documents(id) ON DELETE CASCADE,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(from_type, from_id, edge_type, to_type, to_id, source_resume_id)
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      run_type TEXT NOT NULL,
      business_date TEXT,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      profile_snapshot_json TEXT NOT NULL,
      input_watermark TEXT,
      output_watermark TEXT,
      summary TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      triggered_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_run_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(run_id, entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS search_tasks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      company_name TEXT NOT NULL,
      query_json TEXT NOT NULL,
      reason_json TEXT NOT NULL,
      priority INTEGER NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      claimed_by TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS search_task_feedback (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES search_tasks(id) ON DELETE CASCADE,
      result_count INTEGER NOT NULL,
      qualified_count INTEGER NOT NULL,
      effective_conversations INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learning_weights (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      signal_type TEXT NOT NULL,
      signal_key TEXT NOT NULL,
      sample_count INTEGER NOT NULL,
      positive_count REAL NOT NULL,
      weight REAL NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(campaign_id, signal_type, signal_key)
    );

    CREATE TABLE IF NOT EXISTS learning_recommendations (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
      recommendation_type TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS plugin_sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_org_status ON campaign_organizations(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_campaign_person_status ON campaign_people(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_resumes_status ON resume_documents(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_employments_person ON employments(person_id, start_date);
    CREATE INDEX IF NOT EXISTS idx_employments_org ON employments(organization_id, is_current);
    CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_type, from_id, edge_type);
    CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_type, to_id, edge_type);
    CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nightly_run_unique ON ai_runs(run_type, business_date) WHERE run_type = 'NIGHTLY' AND business_date IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_search_tasks_status ON search_tasks(status, priority DESC, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_search_feedback_task ON search_task_feedback(task_id);
  `);
  db.exec("UPDATE resume_documents SET retention_until = NULL WHERE retention_until IS NOT NULL");
}

export function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function now() {
  return new Date().toISOString();
}

initializeDatabase();
