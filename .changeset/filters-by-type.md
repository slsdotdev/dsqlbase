---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Filters follow the column's type. Every column carries a runtime type — `string`, `uuid`, `number`, `bigint`, `boolean`, `date`, `interval`, `bytes`, `json`, `jsonb`, `array`, `object` — which decides the `where` operators it takes, whether a bare value means `eq`, and whether it can be an `orderBy` key. The types and the runtime follow the same table, so a refused operator also throws when the query is built, before any SQL runs.

- Several operators on one field all apply: `{ pages: { gte: 1, lte: 5 } }` used to keep only the first.
- Filter values go through the column's codec, as inserts and updates do, so a `Date`, a `bigint` or a `Duration` filters the way it is stored.
- `%` and `_` in `beginsWith`, `endsWith` and a string `contains` match themselves, not any text.
- `in: []` matches no row and `notIn: []` every row; both used to fail as SQL.
- An empty `where: {}`, an empty `and` / `or`, and an `or` with a `{}` branch filter nothing. `findOne`, `update` and `delete` refuse an empty `where`.

**Breaking:**

- `bytea` and `json` columns filter by `exists` only, and neither they nor `jsonb` columns can be ordered by; pattern operators are refused on non-string columns, and comparisons on `boolean`. These all built SQL Postgres rejects.
- An unknown operator throws, including an object naming only unknown ones (`{ assigneeId: { isNull: true } }`), which used to be compared as a value. A direction other than `"asc"` / `"desc"` in `orderBy` throws.
- A `%` or `_` in a pattern operator's value no longer acts as a wildcard.
- `@dsqlbase/core`: `ColumnConfig` and `DomainConfig` gain a `runtimeType` parameter. A custom `Session` now receives filter values encoded by the column's codec.

Docs: docs/guide/querying.md, docs/internals/codec-boundary.md
