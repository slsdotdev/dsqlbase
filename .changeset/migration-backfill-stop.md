---
"@dsqlbase/migration": patch
---

A backfill no longer loops forever on a default that is NULL. Making a column `NOT NULL` fills its existing NULLs with the default, batch after batch; a default that evaluated to NULL (`nullif(…)`, a lookup that finds nothing) set the same rows back to NULL, and the next batch picked them again, without end. Each batch now reports which rows it filled, and the step fails, naming the column, at the first batch that fills none. A literal `NULL` default counts as no default: adding a `NOT NULL` column with one is refused (`NOT_NULL_NEEDS_DEFAULT`), and making an existing column `NOT NULL` with one skips the backfill.

Docs: docs/guide/migrations.md (Columns on existing tables), docs/internals/migration-pipeline.md (Operations).
