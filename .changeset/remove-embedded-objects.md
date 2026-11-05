---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Embedded objects are removed. `embedded()` is no longer exported from `dsqlbase/schema`, and `EmbeddedObjectDefinition`, `ColumnGroupDefinition`, `ColumnGroup` and their types are gone from `@dsqlbase/core`. `Table.getColumn` returns a `Column` again, `ColumnRefs` and the index, constraint and primary-key callbacks are flat, and `select`, `where`, `orderBy`, `data` and `return` take columns only. `$onUpdate` still runs on every update.

**Breaking:** a schema using a column group declares its prefixed columns directly. The columns in the database are unchanged.

Docs: docs/decisions/0017-remove-embedded-objects.md, docs/guide/schema.md, docs/guide/querying.md, docs/guide/pagination.md, docs/guide/global-ids.md, docs/guide/migrations.md, docs/guide/README.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, docs/internals/architecture.md, README.md, packages/dsqlbase/README.md
