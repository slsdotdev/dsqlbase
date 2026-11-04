---
"dsqlbase": minor
---

`$findByGlobalId(id)` takes the id alone and returns the row with every column.

**Breaking:** the `{ id, on }` argument is gone. Replace `$findByGlobalId({ id })` with
`$findByGlobalId(id)`. A narrower read (a `select`, `join` or extra `where`) goes through the
table's own `findOne`, which accepts the same id. `$listByGlobalId({ ids, on? })` is unchanged.

Docs: docs/guide/global-ids.md, packages/dsqlbase/README.md, docs/decisions/0007-global-ids.md, docs/decisions/0009-polymorphic-relations.md
