---
"dsqlbase": minor
---

Encode where-clause values through the column's codec.

`Column.param(value)` wraps a value as a parameter encoded by that column's codec, and the normalizer routes `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `between` and the bare-value shorthand through it — for `where`, `update.where` and `delete.where` alike. Filters now agree with what inserts and updates write, instead of relying on the driver to coerce JS values the same way.

- `beginsWith` / `endsWith` / `contains` stay raw: they build a `LIKE` pattern, not a column value.
- A value that is already an `SQLNode` passes through unencoded, so a column reference or sub-expression is never mangled.
- `sql.eq(column, value)` and the rest of `sql.*` are unchanged and still raw. `column.param(value)` is the way to filter a codec column from `$query`.

Breaking: the wire format of filter values changes for columns with a non-identity codec — `date`, `datetime`, `bigint`, `interval`. `pg` and PGlite coerce `Date` and `bigint` themselves, so those columns behaved correctly before and behave correctly now; the change matters for codecs that rewrite the value and for sessions that do not coerce. A custom `Session` that relied on receiving raw JS values will see encoded ones.

Docs: docs/internals/codec-boundary.md, docs/internals/runtime-pipeline.md, docs/guide/querying.md
