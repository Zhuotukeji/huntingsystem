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

    CREATE INDEX IF NOT EXISTS idx_campaign_org_status ON campaign_organizations(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_campaign_person_status ON campaign_people(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
  `);
}

export function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function now() {
  return new Date().toISOString();
}

initializeDatabase();
