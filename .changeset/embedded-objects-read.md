---
"@dsqlbase/core": minor
"dsqlbase": minor
---

Column groups are read as nested objects. `select` and a write's `return` take a group as `true` — every member — or a map of its members, nested groups included; no `select` reads every group. A group whose members are all nullable reads `null` when all of its columns are `NULL`, and projects every column to tell. Each member is decoded and validated by its own column. A `guid()` member carries global ids like any column.

Core adds the runtime `ColumnGroup` (`reader`, `leafColumns`, `nullable`) and `Table.getGroupEntries` / `Table.getLeafEntries`; the registry refuses a relation key or discriminator naming a group member.

Breaking, in `@dsqlbase/core`: `Table.getColumn` returns a `Column` or a `ColumnGroup` (`AnyField`) and no longer finds a column by database name inside a group; `Table.getColumnEntries` lists plain columns only; `FieldSelection` gains a group entry.

Breaking, in `dsqlbase`: `FieldNamesOf` includes column groups; the column-only set is `ColumnFieldNamesOf`. `FieldSelectionOf` and the result types gain group branches.

Docs: docs/guide/embeddable-objects.md (new), docs/guide/querying.md, docs/guide/README.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md
