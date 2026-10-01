---
"@dsqlbase/core": minor
"@dsqlbase/migration": minor
"dsqlbase": minor
---

Filter operators follow the column's runtime type. Every column now carries a runtime type — the kind of value it holds for querying (`string`, `uuid`, `number`, `bigint`, `boolean`, `date`, `interval`, `bytes`, `json`, `array`) — set by each builder and inherited from a domain. One table decides, per runtime type, which `where` operators a column takes, whether a bare value means `eq`, whether it can be an `orderBy` key, and whether `distinct` can compare it. The types and the runtime read the same table, so an operator the types refuse also throws when the query is built, before any SQL runs. `where` inside a field's filter is reserved for a future nested filter and throws.

Fixed: several operators on one field all apply. `{ pages: { gte: 1, lte: 5 } }` rendered only `>= $1` and dropped the rest; it now ANDs them.

Breaking:

- `@dsqlbase/core`: `ColumnConfig` and `DomainConfig` gain `runtimeType` (a new third / fifth type parameter, defaulting to every runtime type). A column built without one is `string`. `Column.runtimeType` is new.
- `dsqlbase`: a `json`, `array` or `bytea` column filters by `exists` only, takes no bare value, and cannot be an `orderBy` key. Every other operator on them built SQL Postgres rejects (`LIKE` on `json`, `=` on `json`) or compared a comma-joined string.
- `dsqlbase`: `contains`, `beginsWith` and `endsWith` are refused on `uuid`, number, date, `interval` and `boolean` columns, and `gt` / `gte` / `lt` / `lte` / `in` / `between` on `boolean`.
- `dsqlbase`: `distinct` throws when a `json` column is selected, including when nothing is named and every column is.
- `dsqlbase`: an operator name no runtime type has (`{ eq: 1, near: 2 }`) throws instead of being ignored.

Docs: docs/guide/querying.md, docs/guide/schema.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md
