---
"dsqlbase": minor
---

`$findByGlobalId(id)` and `$listByGlobalId(ids)` take the ids alone and return rows with every column. The list keeps the order the ids were given, with `null` for a row that is gone: `[a, missing, c]` reads as `[{ … }, null, { … }]`.

**Breaking:** the `{ id, on }` / `{ ids, on }` arguments are gone. Replace `$findByGlobalId({ id })` with `$findByGlobalId(id)` and `$listByGlobalId({ ids })` with `$listByGlobalId(ids)`. A narrower read (a `select`, `join` or extra `where`) goes through the table's own `findOne` / `findMany`, which accept the same ids. The `GlobalIdOptionsOf` and `GlobalIdListResultOf` types are removed; `GlobalIdResultOf` no longer takes an `on` parameter.

Docs: docs/guide/global-ids.md, docs/guide/polymorphic-relations.md, packages/dsqlbase/README.md, docs/decisions/0007-global-ids.md, docs/decisions/0009-polymorphic-relations.md
