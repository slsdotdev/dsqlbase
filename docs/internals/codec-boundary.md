# Codec boundary

_Audience: contributors and agents._

Every column carries a `ColumnConfig.codec { encode, decode }` (`packages/core/src/definition/column.ts`). Date, bigint, interval/duration and `guid()` columns depend on it to present JS values; a future embeddable type would too. Knowing exactly where the codec runs is the difference between a feature that works and one that silently mis-filters.

## Where codecs apply

| Path                                                           | Direction | Location                                                                                                                                  |
| -------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Reading rows, including nested join rows                       | decode    | `Column.resolve` in `packages/core/src/runtime/column.ts`; nested via `_createResultResolver` in `packages/core/src/runtime/operation.ts` |
| Insert values                                                  | encode    | `getInsertValue` in `runtime/column.ts`                                                                                                   |
| Update values                                                  | encode    | `getUpdateValue` in `runtime/column.ts`                                                                                                   |
| Column defaults set from JS                                    | encode    | `ColumnDefinition.default()` in `definition/column.ts`                                                                                    |
| Where-clause values, including `update.where` / `delete.where` | encode    | `Column.param` in `runtime/column.ts`, applied by `packages/dsqlbase/src/client/model/normalizer.ts`                                      |
| Tenant predicate values                                        | encode    | `Column.param`, applied by `_tenantPredicate` in `runtime/operation.ts`                                                                   |
| Tenant claim values on insert                                  | encode    | `getInsertValue` in `runtime/column.ts`, from the identity rather than from `data`                                                        |

## Where codecs do NOT apply

- **Pattern operators** — `beginsWith`, `endsWith`, `contains` build a `LIKE` pattern rather than a column value, so encoding them would corrupt the pattern. They stay raw.
- **`exists`** — a null check, no value.
- **`sql.eq(column, value)` and the rest of `sql.*`** — `packages/core/src/sql/tag.ts` wraps a bare value in an unencoded `SQLParam`. It has no access to the column's codec by design; use `column.param(value)` when hand-writing SQL against a codec column.
- `$query` / `$execute` — by design; they are raw.
- **Keyset cursors** — a cursor carries each order key as the database's own text (`col::text`,
  read off the raw row), and `sql.keyset` binds those values back as bare parameters. No codec
  sees them in either direction, which is deliberate: a codec decodes to a JS value that can
  have lost precision the database still compares on. A `timestamptz` holds microseconds, a
  `Date` milliseconds, so a cursor rebuilt from the decoded `Date` of a row at `.123456`
  becomes `.123` and the next page skips every row in that millisecond. The same holds for a
  bound codec such as the guid wrapper: a guid order key travels as its raw uuid.

## Filtering by a codec column in raw SQL

```ts
sql`${users.columns.createdAt} > ${users.columns.createdAt.param(cutoff)}`;
```

`Column.param` is the filter counterpart to `getInsertValue` / `getUpdateValue`. A value that is already an `SQLNode` passes through untouched, so a column reference or sub-expression is never encoded.

The tenant rows are the one place a value is encoded inside `core` rather than by the normalizer: the predicate is built where the boundary is applied, below the client, so it does not depend on a caller having passed the value through anything.

## A codec bound when the client is built

Most codecs are fixed where the column is declared. `guid()` cannot be: wrapping a value needs
the node key — which defaults to the table's schema alias — and the _target_ node's key field
name, and neither exists until the whole schema does. So `registerNodes`
(`packages/dsqlbase/src/client/nodes.ts`) resolves both when `createClient` runs and installs
the bound codec on the built `Column`, not on the definition. A definition is the user's object
and may be shared by two clients, while a binding depends on the alias the table was exported
under.

Because reads, writes and filters all funnel through the one `codec`, that single swap covers
every direction and no call site changed. A `SchemaRegistry` built outside `createClient` has no
bind pass, so its guid columns behave exactly like the `uuid()` they serialize as.

Global ids are deliberately absent from `@dsqlbase/core`: nothing below the client has an
opinion about the shape of an id. See [0007](../decisions/0007-global-ids.md).

**Note on drivers.** `pg` and PGlite coerce JS `Date` and `bigint` themselves, so those columns filtered correctly even before values were encoded. The encoding matters for a codec that _rewrites_ the value — the guid wrapper, a future embeddable — and for any `Session` implementation that does not do its own coercion. Encoding also makes filters agree with inserts and updates rather than depending on driver behaviour.

## Rules for new work

- A cursor, token or cache key that must compare equal to a stored value carries the
  database's own text for it (`::text`), not a decoded value — decoding can lose precision the
  database still compares on. One that only has to name a value to a caller, and never goes back
  into a comparison, may round-trip through the codec instead; never `JSON.stringify` a decoded
  value alone either way.
- A new column type with a non-identity codec needs a test that filters by that column, so the where-clause gap is caught rather than shipped.

## Related

- [Runtime pipeline](./runtime-pipeline.md)
- [Schema (guide)](../guide/schema.md)
- [Global ids (guide)](../guide/global-ids.md)
