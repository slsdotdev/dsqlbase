---
"@dsqlbase/migration": minor
---

Columns change on existing tables, as far as DSQL allows. Verified on a live cluster.

DSQL's `ADD COLUMN` takes no attributes at all, not even `DEFAULT`, and DSQL has no `SET NOT NULL` or `SET DATA TYPE`. Each change is built from what DSQL does allow:

- **Adding a column** is a bare `ADD COLUMN`, then `SET DEFAULT`. Existing rows stay `NULL`; the step's note says so.
- **A `NOT NULL` column with a default** also gets a **backfill**, then `CHECK (c IS NOT NULL)` named `<table>_<column>_not_null`, added `NOT VALID` and then validated. The backfill is the runner's first data step: `UPDATE … SET c = DEFAULT` on 1,000 rows at a time, one transaction per batch, retried on `40001`, until no `NULL` is left.
- **A `NOT NULL` column without a default** is refused: `NOT_NULL_NEEDS_DEFAULT`.
- **Making an existing column `NOT NULL`** uses the same backfill and CHECK. Without a default, validation fails while a `NULL` is left. Introspection reads the CHECK back as the column's `NOT NULL`.
- **Defaults and `NOT NULL`:** `SET` / `DROP DEFAULT` and `DROP NOT NULL` are emitted. When a CHECK enforces the `NOT NULL`, it is dropped with `DROP CONSTRAINT`.
- **Dropping a column** is `DROP COLUMN` (destructive). It runs after the table's index and constraint steps, and its note flags a possible rename when a column is added in the same plan.
- **Changing a type** is drop + add, followed by the column's default, `NOT NULL`, indexes and constraints (destructive). The note says how to keep the data. On a primary-key column it is refused.
- **Generated columns:** turning one into a plain column is `DROP EXPRESSION` (destructive). Any other generated change is refused.
- **Identity:** options are set in place (`SET INCREMENT BY`, `SET START WITH`, …), never with `RESTART`. Adding an identity needs a `NOT NULL` column from `CREATE TABLE`; otherwise it is refused (`NO_ADD_IDENTITY`). That includes adding an identity column, which used to fail at run time.
- **Blocked destructive steps explain themselves.** The gate error and `formatPlan` carry each such step's note.

Breaking:
- The refusal codes `IMMUTABLE_COLUMN` and `NO_DROP_COLUMN` are gone. The new ones are `NOT_NULL_NEEDS_DEFAULT`, `NO_ADD_GENERATED_COLUMN`, `NO_ADD_IDENTITY`, `NO_ALTER_GENERATED`, `NO_ALTER_PRIMARY_KEY_COLUMN` and `NO_DROP_PRIMARY_KEY_COLUMN`.
- `ADD COLUMN` now uses `IF NOT EXISTS` when `ifExists` is set.
- A new `BACKFILL` action and DDL statement kind.
- A changed identity `startValue` no longer restarts the sequence.

Docs: docs/guide/migrations.md (Columns on existing tables, Refusals, Reporting), docs/guide/dsql-notes.md, docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
