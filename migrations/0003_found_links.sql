-- Official links the reader found that belong to an existing recruitment:
-- apply page, admit card, answer key, result, cut-off, corrigendum.
-- No AI is used: the reader sends the link and its text; the API suggests the matching recruitment;
-- a reviewer attaches it with one click (or dismisses it).
CREATE TABLE found_link (
  id               TEXT PRIMARY KEY,
  source_id        TEXT REFERENCES source(id),
  url              TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('apply_link', 'corrigendum', 'admit_card', 'answer_key', 'result', 'cutoff')),
  link_text        TEXT NOT NULL,
  found_at         TEXT NOT NULL,
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'attached', 'dismissed')),
  opportunity_id   TEXT REFERENCES opportunity(id),
  decided_by       TEXT,
  decided_at       TEXT
);
CREATE INDEX idx_found_link_status ON found_link(status, found_at);
