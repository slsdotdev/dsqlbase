---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`array()` is rebuilt on `jsonb`, and `record()` is new. Both are `jsonb` columns whose value is a JSON array (`array`), or a plain JSON object (`record`), checked on every write and every read, with or without a schema. `.schema()` takes a schema for the whole value, typed so its output must be an array (or an object). `$type<T>()` on an array column takes the item type or the array type (`$type<string>()` and `$type<string[]>()` both give `string[]`); on a record it is the object type exactly as given. Untyped, they read as `unknown[]` and `Record<string, unknown>`.

Both filter by `eq`, `neq`, `contains` (`@>`) and `exists`; a record also by `hasKey` (`?`). On an array, `contains` takes an array of item fragments, never a lone item. Core adds `sql.jsonbHasKey(node, key)`, and `TypeArgOf`, the type `$type<T>()` now sets.

Fixed: `array()` stored `string[]` comma-joined in `text`, so `["a,b"]` read back as `["a","b"]` and `[]` as `[""]`.

Breaking:

- `dsqlbase`: `array()` columns are `jsonb`, not `text`, and hold any JSON items; untyped they are `unknown[]`, not `string[]`. An existing `array()` column cannot be changed in place — DSQL has no `ALTER COLUMN … SET DATA TYPE`, so the planner refuses it (`IMMUTABLE_COLUMN`); migrating one is left to the migrations work.
- `dsqlbase`: the filter operators gain `hasKey`.
- `@dsqlbase/core`: `$type<T>()` returns `ValueType<this, TypeArgOf<this, T>>`, which on a column of runtime type `array` wraps `T` as an array unless it is one.

Docs: docs/guide/schema.md, docs/guide/querying.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md
