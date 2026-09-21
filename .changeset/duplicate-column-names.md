---
"dsqlbase": minor
---

Reject two fields that map to the same database column.

```ts
table("users", {
  name: text("display_name"),
  displayName: text("display_name"), // throws
});
```

Previously the second field silently won: `Table.getColumn(name)` returned whichever it found first, the result resolver reads each row by column name so one field shadowed the other, and `toJSON` emitted the column twice — producing invalid `CREATE TABLE` DDL.

`TableDefinition` now throws when the table is declared, naming both fields. A matching `DUPLICATE_COLUMN_NAME` validation rule covers the migration path, since `validate` also accepts a `SerializedSchema` that never went through the builders.

Breaking: a schema that relied on the shadowing now fails at declaration time.

Docs: docs/guide/schema.md, docs/internals/migration-pipeline.md
