---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`jsonb` columns filter by `eq`, `neq` and `contains`, and `distinct` compares them. `jsonb()` gets its own runtime type, `jsonb`, apart from `json`, which keeps `exists` only since Postgres's `json` has no equality. `eq` / `neq` compare whole documents (object keys in any order, array items in order). `contains` is containment, `@>`: the document holds a fragment, matched recursively — typed as a deep partial of the document, sent as given, and not validated by the column's `.schema()`. On `string` columns `contains` is still `LIKE`. Core adds `sql.jsonbContains(node, value)`.

Breaking:

- `@dsqlbase/core`: `ColumnRuntimeType` gains `jsonb`; a `Record<ColumnRuntimeType, …>` needs an entry for it.
- `dsqlbase`: `jsonb()` columns have runtime type `jsonb`, not `json`. Error messages name them `jsonb`.
- `dsqlbase`: `FilterOf` types `contains` per runtime type, as `ContainsValueOf<R, V>`.

Docs: docs/guide/querying.md, docs/guide/schema.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, packages/dsqlbase/README.md
