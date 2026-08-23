-- V2.0 operating analytics and human resume-quality review audit trail.
BEGIN;

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id UUID PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  metrics_json JSONB NOT NULL,
  dimensions_json JSONB NOT NULL,
  data_quality_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(campaign_id, business_date, window_days)
);

CREATE TABLE IF NOT EXISTS resume_quality_reviews (
  id UUID PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resume_documents(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_campaign_window
  ON analytics_snapshots(campaign_id, window_days, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_resume_quality_reviews_resume
  ON resume_quality_reviews(resume_id, created_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('002_analytics_snapshots')
ON CONFLICT DO NOTHING;

COMMIT;
