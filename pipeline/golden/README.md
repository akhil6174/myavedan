# Golden set

Hand-verified notices used to measure extraction accuracy (milestone M2). Every prompt, schema or model change is scored against this set before it can merge.

For each notice, add a folder:

```
golden/<slug>/
  notice.pdf        the exact official file
  source.json       { "url": "...", "retrieved_at": "...", "sha256": "..." }
  expected.json     the record in snapshot format, with page, section and snippet for every critical field
  notes.md          anything ambiguous, and how the reviewer decided
```

Aim for 25 notices, including at least three each of: scanned PDFs, bilingual Hindi/English notices, multi-post notices, and notices with a corrigendum. Have a second person check each `expected.json`, and record how many minutes labelling took.

Only official files from allowlisted hosts belong here.
