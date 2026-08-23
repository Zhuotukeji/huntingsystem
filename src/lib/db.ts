import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PostgresSyncDatabase, type CompatibleDatabase } from "@/lib/postgres-sync";
import { POSTGRES_SCHEMA_SQL } from "@/lib/postgres-schema.generated";
import { applicationPath, configuredApplicationPath } from "@/lib/runtime-paths";

const databaseUrl = process.env.DATABASE_URL?.trim();
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
if (!databaseUrl && process.env.NODE_ENV === "production" && !isProductionBuild) {
  throw new Error("生产环境必须配置 DATABASE_URL 并使用 PostgreSQL。SQLite 仅用于本地开发、测试和迁移源。");
}

export const databaseDialect = databaseUrl && !isProductionBuild ? "postgres" : "sqlite";
const globalDatabase = globalThis as typeof globalThis & { huntingDb?: CompatibleDatabase };

function createDatabase(): CompatibleDatabase {
  if (isProductionBuild) return new DatabaseSync(":memory:") as unknown as CompatibleDatabase;
  if (databaseUrl) return new PostgresSyncDatabase(databaseUrl);
  const databasePath = process.env.DATABASE_PATH ? configuredApplicationPath(process.env.DATABASE_PATH) : applicationPath(".data", "hunting.db");
  mkdirSync(dirname(databasePath), { recursive: true });
  return new DatabaseSync(databasePath) as unknown as CompatibleDatabase;
}

export const db: CompatibleDatabase = globalDatabase.huntingDb ?? createDatabase();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.huntingDb = db;
}

if (databaseDialect === "sqlite") {
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const journalMode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  if (journalMode.journal_mode.toLowerCase() !== "wal") db.exec("PRAGMA journal_mode = WAL;");
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[], limit = 30) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function inferBusinessStatus(currentBusiness: string[]) {
  const text = currentBusiness.join(" ");
  if (!text) return { status: "UNKNOWN", summary: "现有授权简历尚未提供当前业务证据，暂不判断经营状态。", confidence: 0 };
  if (/(裁员|收缩|缩减|下滑|下降|亏损|停止|关停|流失率上升)/.test(text)) {
    return { status: "CONTRACTING", summary: "当前简历出现业务收缩或经营承压信号，公司可能处于收缩阶段。", confidence: 55 };
  }
  if (/(转型|重组|业务调整|战略调整|转向|新业务线)/.test(text)) {
    return { status: "TRANSFORMING", summary: "当前简历出现业务转型或组织调整信号，公司可能处于转型阶段。", confidence: 55 };
  }
  if (/(增长|提升|新增|扩张|扩大|规模化|突破|从0到1|流水峰值|收入目标|团队搭建)/.test(text)) {
    return { status: "GROWING", summary: "当前简历出现业务扩张、收入提升或团队建设信号，公司可能处于增长阶段。", confidence: 60 };
  }
  if (/(稳定|维持|持续运营|成熟业务)/.test(text)) {
    return { status: "STABLE", summary: "当前简历出现持续运营或指标稳定信号，公司业务可能相对稳定。", confidence: 55 };
  }
  return { status: "UNKNOWN", summary: "现有授权简历尚未提供足够的经营指标，暂不判断增长或收缩。", confidence: 0 };
}

function backfillOrganizationBusinessProfiles() {
  const profiles = db.prepare(`SELECT id, campaign_id, organization_id, products_json, business_history_json, current_business_json, business_signals_json, business_status, business_status_summary, business_status_confidence
    FROM campaign_organizations`).all() as Array<Record<string, string>>;
  const update = db.prepare(`UPDATE campaign_organizations SET products_json = ?, business_history_json = ?, current_business_json = ?, business_signals_json = ?, business_status = ?, business_status_summary = ?, business_status_confidence = ? WHERE id = ?`);
  for (const profile of profiles) {
    const employments = db.prepare(`SELECT e.raw_title, e.start_date, e.end_date, e.is_current, e.summary
      FROM employments e JOIN resume_documents r ON r.id = e.resume_id
      WHERE e.organization_id = ? AND r.campaign_id = ? AND r.graph_eligible = 1 ORDER BY e.is_current DESC, e.start_date DESC`)
      .all(profile.organization_id, profile.campaign_id) as Array<{ raw_title: string; start_date: string | null; end_date: string | null; is_current: number; summary: string }>;
    const factRows = db.prepare(`SELECT f.value_json FROM organization_facts f
      JOIN resume_documents r ON r.id = f.source_resume_id
      WHERE f.organization_id = ? AND r.campaign_id = ? AND f.field_name = 'business_tags' AND f.status = 'PROMOTED_FACT'`)
      .all(profile.organization_id, profile.campaign_id) as Array<{ value_json: string }>;
    const products = uniqueStrings([...parseStringArray(profile.products_json), ...factRows.flatMap((row) => parseStringArray(row.value_json))]);
    const employmentSummary = (employment: (typeof employments)[number]) => {
      const period = [employment.start_date, employment.is_current ? "至今" : employment.end_date].filter(Boolean).join(" - ");
      return [period, employment.raw_title, employment.summary].filter(Boolean).join(" · ");
    };
    const history = uniqueStrings([...parseStringArray(profile.business_history_json), ...employments.filter((item) => !item.is_current).map(employmentSummary)], 20);
    const current = uniqueStrings([...parseStringArray(profile.current_business_json), ...employments.filter((item) => item.is_current).map(employmentSummary)], 20);
    const signals = uniqueStrings([...parseStringArray(profile.business_signals_json), ...current], 12);
    const inferred = inferBusinessStatus(current);
    const hasModelAssessment = profile.business_status && profile.business_status !== "UNKNOWN" && Number(profile.business_status_confidence) > inferred.confidence;
    const businessStatus = hasModelAssessment ? profile.business_status : inferred.status;
    const statusSummary = hasModelAssessment ? profile.business_status_summary : inferred.summary;
    const statusConfidence = hasModelAssessment ? Number(profile.business_status_confidence) : inferred.confidence;
    update.run(JSON.stringify(products), JSON.stringify(history), JSON.stringify(current), JSON.stringify(signals), businessStatus, statusSummary, statusConfidence, profile.id);
  }
}

export function initializeDatabase() {
  if (databaseDialect === "postgres") {
    // Next.js spawns multiple workers during builds. Schema changes belong to runtime startup
    // and migration commands, not concurrent page-data collection.
    if (!isProductionBuild) db.exec(POSTGRES_SCHEMA_SQL);
    return;
  }
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
      business_history_json TEXT NOT NULL DEFAULT '[]',
      current_business_json TEXT NOT NULL DEFAULT '[]',
      business_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      business_status_summary TEXT NOT NULL DEFAULT '',
      business_signals_json TEXT NOT NULL DEFAULT '[]',
      business_status_confidence INTEGER NOT NULL DEFAULT 0,
      fit_score INTEGER NOT NULL,
      evidence_coverage INTEGER NOT NULL,
      confidence INTEGER NOT NULL,
      evidence_source_count INTEGER NOT NULL DEFAULT 0,
      source_quality_score INTEGER NOT NULL DEFAULT 0,
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
      quality_score INTEGER NOT NULL DEFAULT 0,
      quality_grade TEXT NOT NULL DEFAULT 'UNASSESSED',
      quality_reasons_json TEXT NOT NULL DEFAULT '[]',
      quality_metrics_json TEXT NOT NULL DEFAULT '{}',
      graph_eligible INTEGER NOT NULL DEFAULT 0,
      search_eligible INTEGER NOT NULL DEFAULT 0,
      quality_assessed_at TEXT,
      parse_version TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      retention_until TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      analyzed_at TEXT,
      UNIQUE(campaign_id, content_hash)
    );

    CREATE TABLE IF NOT EXISTS resume_identity_matches (
      resume_id TEXT PRIMARY KEY REFERENCES resume_documents(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      matched_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      decision TEXT NOT NULL,
      score REAL NOT NULL,
      confidence REAL NOT NULL,
      reasons_json TEXT NOT NULL,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      classification TEXT NOT NULL DEFAULT 'FACT',
      evidence_quote TEXT NOT NULL DEFAULT '',
      source_quality_score INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_code)
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_versions (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      parent_version_id TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL,
      source_review_run_id TEXT,
      strategy_json TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      superseded_at TEXT,
      UNIQUE(campaign_id, version)
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      strategy_version_id TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      dimension TEXT NOT NULL,
      status TEXT NOT NULL,
      primary_metric TEXT NOT NULL,
      allocation_percent INTEGER NOT NULL DEFAULT 20,
      minimum_tasks INTEGER NOT NULL DEFAULT 5,
      minimum_results INTEGER NOT NULL DEFAULT 30,
      arms_json TEXT NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS experiment_assignments (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
      arm_key TEXT NOT NULL,
      search_task_id TEXT,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      assigned_at TEXT NOT NULL,
      UNIQUE(experiment_id, search_task_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS review_runs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      review_type TEXT NOT NULL,
      status TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      diagnosis_json TEXT NOT NULL,
      proposed_changes_json TEXT NOT NULL,
      applied_changes_json TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      model_name TEXT NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      triggered_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS intelligence_sources (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      trust_tier TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      publisher TEXT NOT NULL,
      published_at TEXT,
      quote TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      UNIQUE(url, content_hash)
    );

    CREATE TABLE IF NOT EXISTS evidence_claims (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      claim_type TEXT NOT NULL,
      classification TEXT NOT NULL,
      statement TEXT NOT NULL,
      value_json TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      status TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      conflict_group_key TEXT NOT NULL DEFAULT '',
      UNIQUE(subject_type, subject_id, claim_type, statement)
    );

    CREATE TABLE IF NOT EXISTS claim_sources (
      claim_id TEXT NOT NULL REFERENCES evidence_claims(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES intelligence_sources(id) ON DELETE CASCADE,
      PRIMARY KEY (claim_id, source_id)
    );

    CREATE TABLE IF NOT EXISTS business_units (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, name)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      business_unit_id TEXT REFERENCES business_units(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      project_type TEXT NOT NULL,
      status TEXT NOT NULL,
      region TEXT NOT NULL,
      client_name TEXT NOT NULL,
      products_json TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      talent_demand_confidence INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      valid_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, name, project_type)
    );

    CREATE TABLE IF NOT EXISTS project_claims (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      claim_id TEXT NOT NULL REFERENCES evidence_claims(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, claim_id)
    );

    CREATE TABLE IF NOT EXISTS organization_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      classification TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      occurred_at TEXT,
      valid_until TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS research_tasks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      model_name TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      dedupe_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      resume_id TEXT REFERENCES resume_documents(id) ON DELETE SET NULL,
      search_task_id TEXT REFERENCES search_tasks(id) ON DELETE SET NULL,
      strategy_version_id TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL,
      experiment_assignment_id TEXT REFERENCES experiment_assignments(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      reason_code TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS candidate_origins (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      resume_id TEXT REFERENCES resume_documents(id) ON DELETE SET NULL,
      search_task_id TEXT REFERENCES search_tasks(id) ON DELETE SET NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      strategy_version_id TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL,
      experiment_assignment_id TEXT REFERENCES experiment_assignments(id) ON DELETE SET NULL,
      keyword_json TEXT NOT NULL,
      source_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      UNIQUE(campaign_id, person_id, resume_id, search_task_id)
    );

    CREATE TABLE IF NOT EXISTS analytics_snapshots (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      business_date TEXT NOT NULL,
      window_days INTEGER NOT NULL,
      metrics_json TEXT NOT NULL,
      dimensions_json TEXT NOT NULL,
      data_quality_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(campaign_id, business_date, window_days)
    );

    CREATE TABLE IF NOT EXISTS resume_quality_reviews (
      id TEXT PRIMARY KEY,
      resume_id TEXT NOT NULL REFERENCES resume_documents(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_org_status ON campaign_organizations(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_campaign_person_status ON campaign_people(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_resumes_status ON resume_documents(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_resume_identity_person ON resume_identity_matches(person_id, decision);
    CREATE INDEX IF NOT EXISTS idx_employments_person ON employments(person_id, start_date);
    CREATE INDEX IF NOT EXISTS idx_employments_org ON employments(organization_id, is_current);
    CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_type, from_id, edge_type);
    CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_type, to_id, edge_type);
    CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nightly_run_unique ON ai_runs(run_type, business_date) WHERE run_type = 'NIGHTLY' AND business_date IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_search_tasks_status ON search_tasks(status, priority DESC, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_search_feedback_task ON search_task_feedback(task_id);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, email);
    CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_activity_campaign_time ON activity_events(campaign_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_person_time ON activity_events(person_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_candidate_origins_person ON candidate_origins(campaign_id, person_id);
    CREATE INDEX IF NOT EXISTS idx_strategy_campaign_status ON strategy_versions(campaign_id, status, version DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_campaign_time ON review_runs(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_research_status ON research_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_claim_subject ON evidence_claims(subject_type, subject_id, status);
    CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_campaign_window ON analytics_snapshots(campaign_id, window_days, business_date DESC);
    CREATE INDEX IF NOT EXISTS idx_resume_quality_reviews_resume ON resume_quality_reviews(resume_id, created_at DESC);
  `);
  ensureColumn("campaign_organizations", "business_history_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("campaign_organizations", "current_business_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("campaign_organizations", "business_status", "TEXT NOT NULL DEFAULT 'UNKNOWN'");
  ensureColumn("campaign_organizations", "business_status_summary", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("campaign_organizations", "business_signals_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("campaign_organizations", "business_status_confidence", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("campaign_organizations", "evidence_source_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("campaign_organizations", "source_quality_score", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("resume_documents", "quality_score", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("resume_documents", "quality_grade", "TEXT NOT NULL DEFAULT 'UNASSESSED'");
  ensureColumn("resume_documents", "quality_reasons_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("resume_documents", "quality_metrics_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("resume_documents", "graph_eligible", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("resume_documents", "search_eligible", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("resume_documents", "quality_assessed_at", "TEXT");
  ensureColumn("organization_facts", "classification", "TEXT NOT NULL DEFAULT 'FACT'");
  ensureColumn("organization_facts", "evidence_quote", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("organization_facts", "source_quality_score", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("resume_documents", "source_search_task_id", "TEXT REFERENCES search_tasks(id) ON DELETE SET NULL");
  ensureColumn("resume_documents", "source_strategy_version_id", "TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL");
  ensureColumn("resume_documents", "experiment_assignment_id", "TEXT REFERENCES experiment_assignments(id) ON DELETE SET NULL");
  ensureColumn("search_tasks", "strategy_version_id", "TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL");
  ensureColumn("search_tasks", "experiment_assignment_id", "TEXT REFERENCES experiment_assignments(id) ON DELETE SET NULL");
  ensureColumn("candidate_origins", "dedupe_key", "TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE candidate_origins SET dedupe_key = campaign_id || '|' || person_id || '|' || COALESCE(resume_id, '') || '|' || COALESCE(search_task_id, '') WHERE dedupe_key = ''`);
  db.exec(`DELETE FROM candidate_origins WHERE id NOT IN (SELECT MIN(id) FROM candidate_origins GROUP BY dedupe_key)`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_origins_dedupe ON candidate_origins(dedupe_key)");
  db.exec(`UPDATE resume_documents SET quality_score = 85, quality_grade = 'HIGH_CONFIDENCE', graph_eligible = 1, search_eligible = 1,
    quality_reasons_json = '["历史已入图谱简历，等待下次重建重新评分"]', quality_assessed_at = COALESCE(analyzed_at, updated_at)
    WHERE status = 'READY' AND quality_score = 0`);
  db.exec(`UPDATE organization_facts SET status = 'PROMOTED_FACT', source_quality_score = COALESCE((SELECT quality_score FROM resume_documents WHERE id = source_resume_id), 85)
    WHERE status = 'EVIDENCE_BACKED'`);
  db.exec(`UPDATE campaign_organizations SET
    evidence_source_count = COALESCE((SELECT COUNT(DISTINCT e.resume_id) FROM employments e JOIN resume_documents r ON r.id = e.resume_id WHERE e.organization_id = campaign_organizations.organization_id AND r.campaign_id = campaign_organizations.campaign_id AND r.graph_eligible = 1), evidence_source_count),
    source_quality_score = COALESCE((SELECT ROUND(AVG(r.quality_score)) FROM employments e JOIN resume_documents r ON r.id = e.resume_id WHERE e.organization_id = campaign_organizations.organization_id AND r.campaign_id = campaign_organizations.campaign_id AND r.graph_eligible = 1), source_quality_score)`);
  db.exec("UPDATE campaign_organizations SET status = 'AI_LEARNED' WHERE status IN ('PENDING_REVIEW', 'APPROVED')");
  backfillOrganizationBusinessProfiles();
  db.exec("UPDATE resume_documents SET retention_until = NULL WHERE retention_until IS NOT NULL");
}

export function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function now() {
  return new Date().toISOString();
}

initializeDatabase();
