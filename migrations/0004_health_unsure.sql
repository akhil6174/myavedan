-- Health report and the "Unsure" list.
--
-- pipeline_run / source_check (from 0001) now receive one report per reader run: what each official
-- site returned, how many links were seen and how many documents were new.
--
-- unsure_link: links on an official site that the reader could not classify (not clearly a notice,
-- result, admit card, tender, ...). Nothing is dropped silently: a reviewer glances at them and either
-- dismisses them or tells the reader what they are, and the next run reads them.
CREATE TABLE unsure_link (
  id           TEXT PRIMARY KEY,
  source_id    TEXT REFERENCES source(id),
  url          TEXT NOT NULL UNIQUE,
  link_text    TEXT NOT NULL,
  found_at     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'queued', 'taken', 'dismissed')),
  kind         TEXT CHECK (kind IN ('notice', 'corrigendum', 'admit_card', 'answer_key', 'result', 'cutoff')),
  decided_by   TEXT,
  decided_at   TEXT
);
CREATE INDEX idx_unsure_link_status ON unsure_link(status, found_at);

ALTER TABLE source_check ADD COLUMN result TEXT;          -- ok | unchanged | failed | paused | blocked | js_page
ALTER TABLE pipeline_run ADD COLUMN host TEXT;            -- which computer ran it
