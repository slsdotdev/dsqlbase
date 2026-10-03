---
"dsqlbase": minor
"@dsqlbase/core": minor
"@dsqlbase/migration": minor
---

A schema that would build wrong queries or DDL now fails when it is declared or when the client is created, naming the problem:

- More than one primary key on a table (`MULTIPLE_PRIMARY_KEYS` in migration validation). A composite key is one constraint over several columns.
- Two fields mapped to one database column (`DUPLICATE_COLUMN_NAME`).
- A relation named like a column of its table: columns and relations share one field namespace.
- A relation whose column pairs differ in number or type, or name a column of the wrong table.
- An identity's explicit sequence name already used in its namespace (`DUPLICATE_SEQUENCE_NAME`).

`Table.primaryKey` and `Table.isCompositeKey` expose the key at runtime, wherever it was declared.

**Fixed:** `PrimaryKeyConstraintDefinition.include()` replaced the key columns with the included ones.

**Breaking:** each schema above used to build and failed later, or silently misbehaved.

Docs: docs/guide/schema.md, docs/guide/relations.md, docs/internals/migration-pipeline.md
