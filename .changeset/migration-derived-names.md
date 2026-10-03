---
"@dsqlbase/migration": patch
---

Constraint and index names the migration planner derives stay within PostgreSQL's 63-byte identifier limit. A longer one was truncated by the server without a word, and the next plan, looking for the full name, never found it: making a column `NOT NULL` on a table and column with long names (`<table>_<column>_not_null`) failed on every later deploy with "already exists". `<table>_<column>_not_null` and `<table>_<column>_key` are now shortened as PostgreSQL shortens its own constraint names, so the latter matches the name the database gave an inline `UNIQUE`. Names only the planner uses (a rebuild's `_rebuild`, a UNIQUE's `_idx`) end in a short fingerprint instead.

Docs: docs/guide/migrations.md (Columns on existing tables), docs/internals/migration-pipeline.md (Operations).
