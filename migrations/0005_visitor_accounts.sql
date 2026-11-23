-- Visitor accounts on myavedan.in (Google sign-in). One row per signed-in visitor:
-- their eligibility profile (date of birth, category, education...) and the recruitments they applied to.
-- Visitors are ordinary users with role 'reader'; they never get console access.
CREATE TABLE visitor_profile (
  user_id       TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  profile_json  TEXT NOT NULL DEFAULT '{}',
  applied_json  TEXT NOT NULL DEFAULT '{}',
  saved_json    TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
