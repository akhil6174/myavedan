-- Local development only: one sample organisation and source on a reserved example domain.
INSERT OR IGNORE INTO organization (id, name, short_name, jurisdiction, state, domains_json)
VALUES ('org_example_board', 'Example Staff Selection Board', 'ESSB', 'central', NULL, '["example.org"]');

INSERT OR IGNORE INTO source (id, organization_id, url, kind, reason, cadence_minutes, tier)
VALUES ('src_example_board', 'org_example_board', 'https://example.org/recruitment', 'html_list',
        'Sample source for local development', 180, 1);
