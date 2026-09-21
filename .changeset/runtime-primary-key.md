---
"dsqlbase": minor
---

Expose the primary key at runtime and enforce that a table has only one.

- `Table.primaryKey: AnyColumn[]` (key order, empty when none) and `Table.isCompositeKey` on `@dsqlbase/core`'s runtime `Table`. Built from whichever source declares the key — the column-level `.primaryKey()` flag or a table-level `primaryKey((c) => [...])` constraint, which was previously invisible at runtime.
- **Breaking:** declaring more than one primary key now throws when the client is created, and is reported as `MULTIPLE_PRIMARY_KEYS` by the migration validator. Two flagged columns, a flagged column alongside a table-level constraint, and two table-level constraints were all accepted before and emitted DDL Postgres rejects (`multiple primary keys for table "x" are not allowed`), because the DDL printer prints each source independently. A composite key is one constraint over several columns.
- **Fix:** `PrimaryKeyConstraintDefinition.include()` assigned `_columns` instead of `_include`, so it replaced the key columns with the included ones and always serialized `include` as `null`. Since the migration pipeline supports `INCLUDE` on primary keys end to end, this emitted the wrong `PRIMARY KEY`.

Docs: docs/internals/runtime-pipeline.md, docs/internals/migration-pipeline.md, docs/guide/schema.md
