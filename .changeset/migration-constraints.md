---
"@dsqlbase/migration": minor
"@dsqlbase/core": patch
---

Constraints and indexes change on existing tables, as DSQL allows. Verified on a live cluster.

- **CHECK:** an added CHECK runs as two steps: `ADD CONSTRAINT … NOT VALID`, enforced on new writes at once, then `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`. If existing rows violate it, the validation job fails, the run stops with the database's message, and the constraint stays, not valid. Once the data is fixed, the next plan is just the `VALIDATE`. A removed CHECK is dropped (lossy).
- **UNIQUE:** a removed UNIQUE is dropped together with its index (lossy). A changed one is dropped and then built and promoted again.
- **Indexes:** a changed index is rebuilt (drop, then create) instead of refused. So is an index whose async build failed.
- **Constraints compare wherever they were declared.** PostgreSQL doesn't record whether a one-column constraint was declared on the column or on the table, so:
  - CHECK and UNIQUE compare by name, and a column's `unique` flag is the constraint PostgreSQL names `<table>_<column>_key`;
  - the primary key compares by its columns.

  This fixes a one-column `table.check()`, `table.unique()` or `table.primaryKey()` that re-planned on every run, and a one-column UNIQUE whose name was lost, so it couldn't be dropped. Introspection keeps UNIQUE constraints at the table level.
- **Validity is read back.** Introspection reads `convalidated` (a CHECK's `validated`) and `indisvalid` (an index's `valid`).
- **`@dsqlbase/core`:** `CheckConstraintDefinition.toJSON()` includes `validated: true`, and `IndexDefinition.toJSON()` includes `valid: true`. A definition describes a valid object.
- `asyncIndexes: false` also drops `ASYNC` from `VALIDATE CONSTRAINT`, for PGlite and Postgres.
- `formatPlan` prints lists as `a, b`, and index columns by name.

Breaking:
- The refusal `IMMUTABLE_CONSTRAINT` now covers primary keys only.
- `IMMUTABLE_INDEX` is gone.
- Primary-key changes on a column (`primaryKey` flag) are refused as `IMMUTABLE_CONSTRAINT`, not `IMMUTABLE_COLUMN`.

Docs: docs/guide/migrations.md (Constraints and indexes on existing tables, Options), docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
