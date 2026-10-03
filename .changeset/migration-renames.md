---
"@dsqlbase/migration": minor
"@dsqlbase/core": minor
"dsqlbase": minor
---

Rename and retire columns and tables without losing data.

- **`.renamedFrom("previous")`** on a column or a table makes the migration emit `RENAME` instead of a drop and an add. Constraints and indexes named after the old name are renamed with it. When both names exist, the rename is refused (`RENAME_CONFLICT`); once the database has the new name, the hint does nothing.
- **`.deprecated()`** on a column hides it from the client — results, filters, ordering and inputs, in the types and at runtime — and marks it in the database with the comment `dsqlbase:deprecated`, dropping its `NOT NULL` when it has no default. A table created with a column already deprecated gets the marker in the same run.
- **In a later release,** removing the column from the definition drops it as a **lossy** step, so it runs without `allow.destructive`.

A primary-key column or an embedded-object member can't be deprecated.

Docs: docs/guide/schema.md, docs/guide/migrations.md
