# Codec boundary

_Audience: contributors and agents._

Every column carries a `ColumnConfig.codec { encode, decode }` (`packages/core/src/definition/column.ts`). Date, bigint, and interval/duration columns depend on it to present JS values; a future GUID-wrapping or embeddable type would too. Knowing exactly where the codec runs is the difference between a feature that works and one that silently mis-filters.

## Where codecs apply

| Path | Direction | Location |
|---|---|---|
| Reading rows, including nested join rows | decode | `Column.resolve` in `packages/core/src/runtime/column.ts`; nested via `_createResultResolver` in `packages/core/src/runtime/operation.ts` |
| Insert values | encode | `getInsertValue` in `runtime/column.ts` |
| Update values | encode | `getUpdateValue` in `runtime/column.ts` |
| Column defaults set from JS | encode | `ColumnDefinition.default()` in `definition/column.ts` |

## Where codecs do NOT apply

- **Where-clause values.** `packages/dsqlbase/src/client/model/normalizer.ts` calls `sql.eq / gt / in / between / ...` (`packages/core/src/sql/tag.ts`), which wrap the value in a bare `SQLParam`. The same is true for the value shorthand and for `update.where` / `delete.where`. A codec that changes the wire representation therefore breaks filtering until the normalizer is codec-aware. **This is a gap to fix, not a rule to work around.**
- `$query` / `$execute` — by design; they are raw.

## Rules for new work

- Any cursor, token, or cache-key serialization must round-trip values through the column codec, never `JSON.stringify` alone.
- A new column type with a non-identity codec needs a test that filters by that column, so the where-clause gap is caught rather than shipped.

## Related

- [Runtime pipeline](./runtime-pipeline.md)
- [Schema (guide)](../guide/schema.md)
