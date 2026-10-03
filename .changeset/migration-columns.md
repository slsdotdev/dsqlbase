---
"@dsqlbase/migration": minor
---

Columns change on existing tables, within what DSQL allows (verified on a live cluster). DSQL's `ADD COLUMN` takes no attributes and DSQL has no `SET NOT NULL` or `SET DATA TYPE`, so each change is built from what it does allow:

- **Adding a column:** `ADD COLUMN`, then `SET DEFAULT`; existing rows stay `NULL`.
- **`NOT NULL`, on a new or an existing column:** a **backfill** of existing rows with the default (1,000 rows per transaction, retried on `40001`), then a `CHECK (c IS NOT NULL)` added `NOT VALID` and validated. The CHECK reads back as the column's `NOT NULL`. A backfill whose default turns out `NULL` stops and fails the step instead of looping. Adding a `NOT NULL` column without a default — a literal `NULL` included — is refused (`NOT_NULL_NEEDS_DEFAULT`).
- **Defaults:** `SET` / `DROP DEFAULT`; `DROP NOT NULL`, or `DROP CONSTRAINT` of the CHECK.
- **Dropping a column** is destructive, and runs after the table's index and constraint steps. With a column added in the same plan, its note flags a possible rename.
- **Changing a type** is drop + add + the column's default, `NOT NULL`, indexes and constraints (destructive); refused on a primary-key column.
- **Generated and identity columns:** a generated column can be made plain (`DROP EXPRESSION`); identity options change in place, never with `RESTART`.

**Breaking:** the refusal codes `IMMUTABLE_COLUMN` and `NO_DROP_COLUMN` are replaced by `NOT_NULL_NEEDS_DEFAULT`, `NO_ADD_GENERATED_COLUMN`, `NO_ADD_IDENTITY`, `NO_ALTER_GENERATED`, `NO_ALTER_PRIMARY_KEY_COLUMN` and `NO_DROP_PRIMARY_KEY_COLUMN`. A changed identity start value no longer restarts its sequence.

Docs: docs/guide/migrations.md, docs/internals/migration-pipeline.md
