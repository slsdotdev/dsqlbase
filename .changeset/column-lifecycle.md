---
"@dsqlbase/core": minor
"dsqlbase": minor
"@dsqlbase/migration": minor
---

Rename and retire columns and tables without losing data. Verified on a live DSQL cluster.

- **`.renamedFrom("previous")`** on a column or a table (`table("people", …).renamedFrom("users")`). The migration emits `RENAME COLUMN` or `ALTER TABLE … RENAME TO` instead of a drop and an add, which would lose the data.
  - Constraints and indexes named after the old name are renamed with it: `<table>_<column>_key`, `<column>_check`, `<table>_<column>_not_null`, and a table's `<table>_…` names. That holds when the table and its columns are renamed together, too.
  - The hint does nothing once the database has the new name.
  - When both names exist, the rename is refused: `RENAME_CONFLICT`.
- **`.deprecated()`** on a column:
  - **Client:** the column disappears from results, filters, ordering and inputs, in the types (`ColumnFieldNamesOf`, `TableColumns`) and at runtime (the built `Table` leaves it out).
  - **Migration:** the column is marked in the database with the comment `dsqlbase:deprecated`. A `NOT NULL` column without a default is serialized as nullable, so `DROP NOT NULL` lets inserts leave it out.
  - **Later release:** once the column is removed from the definition, its drop is **lossy** instead of destructive, so it runs without `allow.destructive`. A primary-key column or an embedded-object member can't be deprecated; declaring one throws.
- `toJSON()` adds `deprecated` and `renamedFrom` to a column, and `renamedFrom` to a table. Introspection reads the deprecation marker.

Docs: docs/guide/schema.md (Renaming and retiring columns), docs/guide/migrations.md (Renames and deprecation, Refusals), docs/guide/dsql-notes.md, docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
