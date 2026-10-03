---
"@dsqlbase/migration": patch
---

A table created with a column already `.deprecated()` — a fresh environment built from the current definition — gets the column's `dsqlbase:deprecated` marker in the same run. Before, `CREATE TABLE` left it out, so the next plan was not empty, and dropping the column before that second run was planned as destructive instead of lossy.

Docs: docs/guide/migrations.md (Renames and deprecation), docs/internals/migration-pipeline.md (Operations).
