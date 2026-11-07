---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`update` / `delete` now change exactly one row, and `updateMany` / `deleteMany` change every row a
filter matches and return all of them. Previously `update` / `delete` changed every match and
returned only the first.

`Table.uniqueKeys` (core) lists every field set that names at most one row: the primary key,
unique columns, unique constraints and non-partial unique indexes.

**Breaking (`dsqlbase`):**

- `update` / `delete` refuse a `where` that does not compare every field of a unique key for
  equality with a non-null value (at the top level or inside `and`), before any SQL runs. Use
  `updateMany` / `deleteMany` for a filter that may match several rows.

Docs: docs/guide/querying.md, docs/internals/runtime-pipeline.md, docs/decisions/0023-update-many.md, docs/decisions/README.md
