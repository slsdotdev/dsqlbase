# Codec boundary

_Audience: contributors and agents._

Every column carries a `ColumnConfig.codec { encode, decode }` (`packages/core/src/definition/column.ts`). Date, bigint, interval/duration and `guid()` columns depend on it to present JS values; a future embeddable type would too. Knowing exactly where the codec runs is the difference between a feature that works and one that silently mis-filters.

A codec **translates** and nothing else. Checking a value is the column's optional `ColumnConfig.validator { write, read }`, which runs on writes and reads only — never on filters; see [Validators](#validators-run-on-writes-and-reads-never-on-filters).

## Where codecs apply

| Path                                                           | Direction | Location                                                                                                                                  |
| -------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Reading rows, including nested join rows                       | decode    | `Column.resolve` in `packages/core/src/runtime/column.ts`; nested via `_createResultResolver` in `packages/core/src/runtime/operation.ts` |
| Insert values                                                  | encode    | `getInsertValue` in `runtime/column.ts`                                                                                                   |
| Update values                                                  | encode    | `getUpdateValue` in `runtime/column.ts`                                                                                                   |
| Column defaults set from JS                                    | encode    | `ColumnDefinition.default()` in `definition/column.ts`                                                                                    |
| Where-clause values, including `update.where` / `delete.where` | encode    | `Column.param` in `runtime/column.ts`, applied by `WhereBuilder` in `packages/dsqlbase/src/client/model/filters.ts`                       |
| Tenant predicate values                                        | encode    | `Column.param`, applied by `_tenantPredicate` in `runtime/operation.ts`                                                                   |
| Tenant claim values on insert                                  | encode    | `getInsertValue` in `runtime/column.ts`, from the identity rather than from `data`                                                        |

## Where codecs do NOT apply

- **Pattern operators** — `beginsWith`, `endsWith`, `contains` on a `string` column build a `LIKE` pattern rather than a column value, so encoding them would corrupt the pattern. They stay raw, and only `string` columns take them as patterns (see [Operators by runtime type](./runtime-pipeline.md#operators-by-runtime-type)), so they never meet a codec that rewrites values. On a `jsonb` column `contains` is a document fragment instead, and goes through `Column.param`: encoded, not validated.
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

## Validators: run on writes and reads, never on filters

A column may carry a `ColumnValidator` (`packages/core/src/definition/base.ts`) beside its codec.
`Column` (`packages/core/src/runtime/column.ts`) runs it around the codec:

| Path                                                                               | Order                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------- |
| insert, update, `$onCreate`, `$onUpdate` (`getInsertValue`, `getUpdateValue`)      | `validator.write`, then `codec.encode` |
| `ColumnDefinition.default()`                                                       | `validator.write`, then `codec.encode` |
| reads, root and joined (`Column.resolve`), and a row decoder (`Column.resolveRow`) | `codec.decode`, then `validator.read`  |
| where-clause values, tenant predicates (`Column.param`)                            | `codec.encode` only                    |

`NULL` reaches neither. A filter value is compared with stored values, not stored, and may be a
fragment of one (a containment pattern), so validating it would refuse or rewrite it. This is why
validation is not in the codec: every value bound for the column passes through `encode`, so a
codec that validated would validate filters too. `write` takes the column's `inputType` and
returns its `valueType`; `Column.param` takes `valueType`.

Core gives the validator no meaning. `dsqlbase` installs one for `.schema()` on JSON columns,
below.

## Joined and union rows: exact types travel as text

A joined row and every union row reach the client inside JSON (`row_to_json`, `json_agg` in
`packages/core/src/runtime/query.ts`), parsed by the driver before any codec runs. JSON has one
number type, so `bigint` and `numeric` would arrive as doubles — `9007199254740993` as
`9007199254740992` — where a root read hands the codec the database's exact text. A level read as
JSON therefore projects every column whose `Column.textInJson` is set (runtime type `bigint`, or
SQL type `bigint` / `int8` / `numeric` / `decimal`) as `::text`, under its own name
(`_resolveSelectParams` in `packages/core/src/runtime/operation.ts`): the codec gets the same
string at every depth. Other types arrive as JSON renders them, and their codecs accept that.

## JSON columns: the driver parses, the validator checks

`json` and `jsonb` columns (`packages/dsqlbase/src/schema/columns/json.ts`) rely on the session
returning them **parsed**, as `pg` and PGlite do, and a joined row arrives inside parsed JSON
anyway. Their decode therefore never parses: it receives a value, and a JSON string such as
`"123"` stays the string it is. (It used to parse any string again, so `"123"` read back as the
number `123`.) A custom `Session` must return JSON columns parsed.

Encode is `JSON.stringify`, with or without a schema. `.schema(s)` installs a validator:

- **write** validates, serializes the schema's output, validates that serialized form again and
  requires it to serialize identically (the stability check), then hands the output to encode;
- **read** validates the decoded value and returns the schema's output.

`array()` and `record()` are JSON columns with a shape: their validator checks that a value is
an array, or a plain object, on every write (after the schema, on what will be stored) and every
read (before the schema), with or without `.schema()`. The filters on them rely on it.

A validator cannot await, so a schema that returns a `Promise` throws. Writes and reads have
their own types here: `ColumnConfig.inputType` carries the write side (`CreateValuesOf` /
`UpdateValuesOf`, `.default()`, `$onCreate`, `$onUpdate`), `valueType` the read side and filters.
They are the same type for every other column.

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

## A decode that reads the row

A codec decodes one value. The `from` column of a
[belongs-to a union](../guide/polymorphic-relations.md#a-belongs-to-a-union) needs two: its id,
and the discriminator naming which member, and so which node key, the id belongs to. A codec
cannot see that sibling, so the read side is a **row decoder** instead:

- **Core** (`Column.rowDecoder` / `Column.resolveRow` in `packages/core/src/runtime/column.ts`)
  is the guid-agnostic seam. A built column may declare `dependsOn` columns and
  `decode(raw, row)`. `_resolveFields` then projects the dependencies whenever the column is
  selected, without emitting them as fields, and resolves the field through a `MetaResolver`
  over the raw row. That is the resolver kind [0004](../decisions/0004-record-meta.md) set
  aside for a value computed from the row.
- **Client** (`bindDynamicGuid` in `packages/dsqlbase/src/client/nodes.ts`) sets it on the built
  column when `createClient` runs, next to a codec whose `encode` accepts an id for any member.
  A `NULL` discriminator, or one naming no member, reads the id raw.
- **Filters and writes** that need the discriminator, such as a global-id `eq` becoming
  `(discriminator = key AND id = pk)` or a write filling the discriminator, are the client's
  job: `WhereBuilder._getPolymorphicFilter` (`filters.ts`) and the normalizer's
  `_fillDiscriminators`. Only they see the whole filter or the whole row.

**Note on drivers.** `pg` and PGlite coerce JS `Date` and `bigint` themselves, so those columns filtered correctly even before values were encoded. The encoding matters for a codec that _rewrites_ the value — the guid wrapper, a future embeddable — and for any `Session` implementation that does not do its own coercion. Encoding also makes filters agree with inserts and updates rather than depending on driver behaviour.

## Column groups

A column group's members are ordinary columns, each with its own codec and validator, so every
boundary above applies per member: a group is decoded member by member when it is read, and each
member value is validated and encoded on its own when it is written or filtered. A group has no
codec or validator of its own; a check across members is not supported yet.

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
