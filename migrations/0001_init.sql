-- MyAvedan D1 schema v1.
-- Two lifecycles are kept apart:
--   document_version.state  = pipeline state (discovered … published / superseded)
--   opportunity status      = never stored; computed from dates and events (packages/schema/src/status.ts)
-- Every published fact points at an evidence row, which points at a page of one document version.
-- D1 enforces foreign keys by default.

-- ---------------------------------------------------------------- provenance

CREATE TABLE organization (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  short_name    TEXT,
  jurisdiction  TEXT NOT NULL CHECK (jurisdiction IN ('central', 'state', 'ut')),
  state         TEXT,
  domains_json  TEXT NOT NULL DEFAULT '[]',          -- official hosts, exact match
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE source (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organization(id),
  url              TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('rss', 'html_list', 'pdf_index', 'manual')),
  reason           TEXT NOT NULL,                       -- why this source is included
  cadence_minutes  INTEGER NOT NULL DEFAULT 180,
  tier             INTEGER NOT NULL DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
  active           INTEGER NOT NULL DEFAULT 1,
  etag             TEXT,
  last_modified    TEXT,
  last_checked_at  TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pipeline_run (
  id            TEXT PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  trigger       TEXT NOT NULL,                          -- schedule | dispatch | manual
  counts_json   TEXT NOT NULL DEFAULT '{}',             -- per-stage counts
  ai_calls      INTEGER NOT NULL DEFAULT 0,
  errors_json   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE source_check (
  id               TEXT PRIMARY KEY,
  source_id        TEXT NOT NULL REFERENCES source(id),
  pipeline_run_id  TEXT REFERENCES pipeline_run(id),
  checked_at       TEXT NOT NULL,
  http_status      INTEGER,
  links_found      INTEGER,
  new_documents    INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);
CREATE INDEX idx_source_check_source ON source_check(source_id, checked_at);

-- ---------------------------------------------------------------- facts

CREATE TABLE opportunity (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  organization_id    TEXT NOT NULL REFERENCES organization(id),
  type               TEXT NOT NULL DEFAULT 'job',
  title              TEXT NOT NULL,
  advt_no            TEXT,
  publish_state      TEXT NOT NULL DEFAULT 'draft' CHECK (publish_state IN ('draft', 'published', 'withdrawn')),
  current_version_id TEXT,                              -- approved document_version now live
  published_json     TEXT,                              -- approved record in snapshot format, read by the publish job
  apply_end          TEXT,                              -- denormalised for queue priority and dashboards
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_opportunity_org ON opportunity(organization_id);
CREATE INDEX idx_opportunity_state ON opportunity(publish_state, apply_end);
CREATE INDEX idx_opportunity_advt ON opportunity(advt_no);

-- A notice, corrigendum, admit-card notice, answer key or result: one opportunity collects several.
CREATE TABLE document (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT REFERENCES opportunity(id),      -- null until linked (stage 04)
  source_id       TEXT REFERENCES source(id),
  kind            TEXT NOT NULL CHECK (kind IN ('notice', 'corrigendum', 'admit_card', 'answer_key', 'result', 'cutoff', 'other')),
  url             TEXT NOT NULL,
  advt_no         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_document_opportunity ON document(opportunity_id);
CREATE UNIQUE INDEX idx_document_url ON document(url);

-- The exact bytes of a document at one point in time.
CREATE TABLE document_version (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES document(id),
  sha256          TEXT NOT NULL UNIQUE,
  r2_key          TEXT NOT NULL,
  content_type    TEXT,
  bytes           INTEGER,
  pages           INTEGER,
  retrieved_at    TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN (
                    'discovered', 'downloaded', 'parsed', 'extracted', 'validation_failed',
                    'needs_review', 'approved', 'published', 'superseded', 'rejected',
                    'duplicate', 'fetch_failed', 'archived')),
  draft_json      TEXT,                                 -- extraction draft with evidence and flags
  flags_json      TEXT NOT NULL DEFAULT '[]',           -- validation and grounding flags
  version_no      INTEGER NOT NULL DEFAULT 1,
  change_note     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_version_state ON document_version(state);
CREATE INDEX idx_version_document ON document_version(document_id);

-- Page-aware text chunks for notice-scoped Q&A. Kept only for live notices; older text moves to R2.
CREATE TABLE chunk (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  document_version_id  TEXT NOT NULL REFERENCES document_version(id),
  page                 INTEGER NOT NULL,
  section              TEXT,
  text                 TEXT NOT NULL
);
CREATE INDEX idx_chunk_version ON chunk(document_version_id);
CREATE VIRTUAL TABLE chunk_fts USING fts5(text, content='chunk', content_rowid='id');
CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
  INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE evidence (
  id                   TEXT PRIMARY KEY,
  document_version_id  TEXT NOT NULL REFERENCES document_version(id),
  field_key            TEXT NOT NULL,                   -- e.g. dates.apply_end, posts.junior-assistant.rules.age
  page                 INTEGER NOT NULL,
  section              TEXT,
  snippet              TEXT NOT NULL,
  grounded             INTEGER NOT NULL DEFAULT 0,      -- snippet found on the cited page
  review_state         TEXT NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending', 'approved', 'edited', 'rejected'))
);
CREATE INDEX idx_evidence_version ON evidence(document_version_id, field_key);

CREATE TABLE post (
  id               TEXT PRIMARY KEY,
  opportunity_id   TEXT NOT NULL REFERENCES opportunity(id),
  post_key         TEXT NOT NULL,
  name             TEXT NOT NULL,
  vacancies        INTEGER,
  location         TEXT,
  pay              TEXT,
  evidence_id      TEXT REFERENCES evidence(id),
  UNIQUE (opportunity_id, post_key)
);

CREATE TABLE eligibility_rule (
  id             TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL REFERENCES post(id),
  kind           TEXT NOT NULL CHECK (kind IN ('dob_window', 'qualification', 'other')),
  rule_json      TEXT NOT NULL,                         -- validated by packages/schema Rule
  evidence_id    TEXT REFERENCES evidence(id)
);
CREATE INDEX idx_rule_post ON eligibility_rule(post_id);

CREATE TABLE important_date (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL REFERENCES opportunity(id),
  kind            TEXT NOT NULL,
  value           TEXT,                                 -- YYYY-MM-DD or YYYY-MM-DDTHH:mm+05:30
  approx          TEXT,
  tentative       INTEGER NOT NULL DEFAULT 0,
  evidence_id     TEXT REFERENCES evidence(id)
);
CREATE INDEX idx_date_opportunity ON important_date(opportunity_id, kind);

CREATE TABLE opportunity_event (
  id              TEXT PRIMARY KEY,
  opportunity_id  TEXT NOT NULL REFERENCES opportunity(id),
  document_id     TEXT REFERENCES document(id),
  kind            TEXT NOT NULL CHECK (kind IN ('corrigendum', 'admit_card', 'answer_key', 'result', 'cutoff', 'postponed', 'cancelled')),
  event_date      TEXT NOT NULL,
  title           TEXT NOT NULL,
  link            TEXT NOT NULL,
  evidence_id     TEXT REFERENCES evidence(id)
);
CREATE INDEX idx_event_kind_date ON opportunity_event(kind, event_date);

-- ---------------------------------------------------------------- review and publishing

CREATE TABLE review_event (
  id                   TEXT PRIMARY KEY,
  document_version_id  TEXT NOT NULL REFERENCES document_version(id),
  reviewer             TEXT NOT NULL,                   -- Cloudflare Access email
  action               TEXT NOT NULL CHECK (action IN ('approve_field', 'edit_field', 'reject_field', 'approve', 'reject', 'reprocess', 'link')),
  field_key            TEXT,
  old_value            TEXT,
  new_value            TEXT,
  reason               TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_review_version ON review_event(document_version_id, created_at);

CREATE TABLE correction (
  id               TEXT PRIMARY KEY,
  opportunity_slug TEXT NOT NULL,
  field_key        TEXT NOT NULL,
  message          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'not_an_error', 'fixed')),
  ip_hash          TEXT,                                -- salted hash for abuse limits only
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at      TEXT
);
CREATE INDEX idx_correction_status ON correction(status, created_at);

CREATE TABLE publish_batch (
  id            TEXT PRIMARY KEY,
  requested_at  TEXT NOT NULL,
  dispatched_at TEXT,
  deployed_at   TEXT,
  urgent        INTEGER NOT NULL DEFAULT 0,
  versions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE publish_queue (
  document_version_id  TEXT PRIMARY KEY REFERENCES document_version(id),
  queued_at            TEXT NOT NULL,
  urgent               INTEGER NOT NULL DEFAULT 0,
  batch_id             TEXT REFERENCES publish_batch(id)
);

CREATE TABLE ai_request_log (
  id                   TEXT PRIMARY KEY,
  purpose              TEXT NOT NULL CHECK (purpose IN ('section_map', 'extract', 'summarise', 'answer')),
  model                TEXT NOT NULL,
  document_version_id  TEXT,
  question_hash        TEXT,                            -- never the question text
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  status               TEXT NOT NULL,
  quota_bucket         TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE qa_cache (
  document_version_id  TEXT NOT NULL REFERENCES document_version(id),
  question_hash        TEXT NOT NULL,
  question_text        TEXT,                            -- only for reviewed suggested prompts
  answer_json          TEXT NOT NULL,
  reviewed             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (document_version_id, question_hash)
);

-- ---------------------------------------------------------------- applicants (Phase 2)

CREATE TABLE user_profile (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  preferences_json   TEXT NOT NULL DEFAULT '{}',        -- qualification, stream, states
  dob                TEXT,                              -- only with consent
  category           TEXT,                              -- only with consent
  consent_json       TEXT NOT NULL DEFAULT '{}',        -- field → consented_at
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE saved_opportunity (
  user_id          TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  opportunity_id   TEXT NOT NULL REFERENCES opportunity(id),
  saved_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reminders        INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  PRIMARY KEY (user_id, opportunity_id)
);

CREATE TABLE checklist_item (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  opportunity_id   TEXT NOT NULL REFERENCES opportunity(id),
  task             TEXT NOT NULL,
  done             INTEGER NOT NULL DEFAULT 0,
  evidence_id      TEXT REFERENCES evidence(id)
);

CREATE TABLE notification (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user_profile(id) ON DELETE CASCADE,
  opportunity_id   TEXT NOT NULL REFERENCES opportunity(id),
  event            TEXT NOT NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('in_app', 'web_push', 'email')),
  status           TEXT NOT NULL DEFAULT 'queued',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
