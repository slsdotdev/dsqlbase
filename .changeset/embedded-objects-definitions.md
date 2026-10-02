---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`embedded()` declares a reusable value object; `.column(name)` places it in a table as a column group — one column per member, named `<name>_<member>`, each a copy with its own type, codec, validator and `.notNull()`. Groups nest, take `.default(obj)`, and are reached through nested refs in `check`, `unique`, `primaryKey` and `index` callbacks (`c.netValue.amount`). A table serializes every member as a plain column.

Core adds `EmbeddedObjectDefinition`, `ColumnGroupDefinition`, `columnEntries`, `Kind.EMBEDDED_OBJECT` / `Kind.COLUMN_GROUP` and `ColumnDefinition._renamed`.

Breaking, in `@dsqlbase/core`: `TableConfig.columns` and the table, namespace and tenant-scope column maps accept groups (`TableColumnDefinitions`); `ColumnRefs` nests for a group, and constraint and index callbacks return `ColumnRefOf` (any ref, however deep); `ColumnConfigRefs` nests; `IndexColumnDefinition`'s column parameter is any `DefinitionNode`.

Docs: docs/guide/schema.md, docs/internals/architecture.md
