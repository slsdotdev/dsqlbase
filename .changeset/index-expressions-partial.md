---
"@dsqlbase/core": minor
"@dsqlbase/migration": minor
---

Expression and partial indexes.

- **`@dsqlbase/core`:**
  - `IndexDefinition.columns()` takes expressions over the columns as keys: `.columns((c) => [sql\`lower(${c.email})\`, c.id])`. An `IndexColumnDefinition` is usable in `sql`.
  - `.where((c) => sql\`…\`)` makes the index partial.
  - `toJSON()` gives an expression key as `{ column: null, expression }` and adds `where`.
- **`@dsqlbase/migration`:**
  - Expression keys and predicates are emitted, and introspection reads them via `pg_get_indexdef(oid, n, true)` and `pg_get_expr(indpred)`. They used to be dropped, since an expression key has no column.
  - Keys compare by position and predicates by presence: PostgreSQL prints both back reformatted. To change an expression or a predicate, rename the index.
  - Validation skips expression keys when it checks column references.
- **Fixed:** introspection read `pg_index.indoption` 1-based, but it is 0-based. A `NULLS FIRST` key read back as `LAST`, so every such index re-planned. Verified on a live DSQL cluster.

Docs: docs/guide/schema.md, docs/guide/migrations.md, docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
