# Codec boundary

_Audience: contributors and agents._

Every column carries a `ColumnConfig.codec { encode, decode }` (`ColumnCodec`, `packages/core/src/resolvers/codec.ts`). Date, bigint, interval/duration and JSON columns depend on it to present JS values. Knowing exactly where the codec runs is the difference between a feature that works and one that silently mis-filters.

A codec **translates** one value and nothing else. It is pure — it sees the value and no context — which is why a definition can run it for a DDL default. Two things sit around it:

- the optional `ColumnConfig.validator { write, read }` checks values, on writes and reads only — never on filters; see [Validators](#validators-run-on-writes-and-reads-never-on-filters);
- the optional `ColumnConfig.hooks { read, write }` transforms values with what a codec cannot see — the runtime column and, on a read, the row. Only the runtime `Column` runs them; `guid()` is built on them. See [Column hooks](#column-hooks).

`ColumnCodec`, `ColumnValidator` and `ColumnHooks` live in `packages/core/src/resolvers/`, the module for what a definition declares and the runtime runs.

## Where codecs apply

| Path                                                           | Direction | Location                                                                                                                                  |
| -------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Reading rows, including nested join rows                       | decode    | `Column.resolve` in `packages/core/src/runtime/column.ts`; nested via `_createResultResolver` in `packages/core/src/runtime/operation.ts` |
| Insert values                                                  | encode    | `getInsertValue` in `runtime/column.ts`                                                                                                   |
| Update values                                                  | encode    | `getUpdateValue` in `runtime/column.ts`                                                                                                   |
| Column defaults set from JS                                    | encode    | `ColumnDefinition.default()` in `definition/column.ts`                                                                                    |
| Where-clause values, including `update.where` / `delete.where` | encode    | `Column.param` in `runtime/column.ts`, applied by `WhereBuilder` in `packages/dsqlbase/src/client/model/filters.ts`                       |
| Setting values (row policies, `$onCreate` returning a setting) | encode    | `SQLSetting` in `packages/core/src/sql/nodes.ts`, by the setting's own column codec — no validator, no hooks                              |

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
  hook such as the guid wrapper: a guid order key travels as its raw uuid.

## Validators: run on writes and reads, never on filters

A column may carry a `ColumnValidator` (`packages/core/src/resolvers/validator.ts`) beside its codec.
`Column` (`packages/core/src/runtime/column.ts`) runs it around the codec:

| Path                                                                          | Order                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| insert, update, `$onCreate`, `$onUpdate` (`getInsertValue`, `getUpdateValue`) | `validator.write`, then `hooks.write`, then `codec.encode` |
| `ColumnDefinition.default()`                                                  | `validator.write`, then `codec.encode` — no hooks          |
| reads, root, joined and union branches (`Column.resolve`)                     | `codec.decode`, then `hooks.read`, then `validator.read`   |
| where-clause values (`Column.param`)                                          | `hooks.write`, then `codec.encode`                         |
| settings (`SQLSetting`)                                                       | `codec.encode` of the setting's column — no hooks          |

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

`numeric()` relies on this for its read `mode` (`packages/dsqlbase/src/schema/columns/numeric.ts`):
`"number"` parses the text to a double, `"string"` returns it unchanged, and a decimal class is
built from it with `new Mode(text)`. The latter two are lossless only because the text is the
database's at every depth. Encode is `String(value)` in every mode, which a decimal class's
`toString()` satisfies — exponent notation included, as Postgres reads it. The write validator
converts a `string` or `number` input to the read form — in those two modes the column's
`inputType` is wider than its `valueType` — and checks precision and scale on that value's text.

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
They are the same type for every other column except `numeric()` in `"string"` or class
mode (above).

## Filtering by a codec column in raw SQL

```ts
sql`${users.columns.createdAt} > ${users.columns.createdAt.param(cutoff)}`;
```

`Column.param` is the filter counterpart to `getInsertValue` / `getUpdateValue`. A value that is already an `SQLNode` passes through untouched, so a column reference or sub-expression is never encoded.

Settings are the one place a value is encoded inside `core` rather than by the normalizer: a setting is bound where a policy or `$onCreate` reads it, below the client, so it does not depend on a caller having passed the value through anything. Only its column's codec runs — a setting has no table for a hook to read references from, and it is compared or copied, not validated as input. An unset setting is `NULL` and reaches no codec.

## Column hooks

A codec decodes one value, but some values mean something only next to others: a `guid()` id
names the node its column references — known once relations are linked — and, for a belongs-to
a union, the member its row's discriminator names. `ColumnHooks`
(`packages/core/src/resolvers/hooks.ts`) carry that:

- `read(value, { column, row })` runs after the codec decodes, before the read validator;
- `write(value, { column })` runs before the codec encodes, on every value bound for the column —
  writes, after the write validator, and filters.

`column` is the runtime `Column`, its references already linked and frozen, so a hook reads
`column.references` / `column.resolveReferences()` when it runs and nothing is bound up front.
`row` is the raw row of the level being read — the root row, a joined level, or a union branch
(`_createResultResolver` in `packages/core/src/runtime/operation.ts`). Which siblings it holds is
core's decision, not the hook's: `Column.dependsOn` is the discriminator of each union reference,
and `_resolveFields` projects it whenever the column is selected, with or without hooks.

A definition never runs hooks. `.default()` renders a DDL default, which has no runtime column,
so it goes through the validator and the codec alone. That is what keeps the codec pure.

**Validation.** A value crosses a relation as it is read and written, so `validateSchema`
(`packages/core/src/validation/`) requires both columns of a pair to carry the same hooks
object, and a column with hooks — whose value is read through what it references — to reference
one target: every chain from it ends at one column, or one union whose members are each reached
through a single-column unique key. A ring of references is refused for every column. A plain
column may still reference two targets.

**Global ids.** `guid()` (`packages/dsqlbase/src/schema/columns/guid.ts`) is a `uuid` codec plus
`guidHooks` (`packages/dsqlbase/src/schema/utils/guid-hooks.ts`), one object shared by every guid
column:

- the binding — what a column's ids name — is read from `column.resolveReferences()` the first
  time a hook runs, and kept per built column in a `WeakMap`: the `(alias, field)` of the column
  its chains end at, its own when nothing is referenced through it, or, for a union reference, the
  discriminator and each member's key field;
- `read` wraps with that node, or with the member `row[discriminator.name]` names — a stored
  discriminator or a computed one alike. A `NULL` discriminator, or one naming no member, reads
  the id raw;
- `write` unwraps, refusing an id naming another node, or a non-member.

Filters and writes that need the discriminator — a global-id `eq` becoming
`(discriminator = key AND id = pk)`, a write filling the discriminator — read the same binding
(`getGuidBinding` / `getDynamicGuidBinding`) in `WhereBuilder._getPolymorphicFilter`
(`filters.ts`) and the normalizer's `_fillDiscriminators`, the only places that see the whole
filter or row. Since the hooks travel with the column, a `SchemaRegistry` built without
`createClient` wraps ids too. Global ids stay out of `@dsqlbase/core`: core runs hooks without
knowing what they do. See [0007](../decisions/0007-global-ids.md),
[0022](../decisions/0022-column-hooks.md).

**Note on drivers.** `pg` and PGlite coerce JS `Date` and `bigint` themselves, so those columns filtered correctly even before values were encoded. The encoding matters for a codec that _rewrites_ the value — the guid wrapper — and for any `Session` implementation that does not do its own coercion. Encoding also makes filters agree with inserts and updates rather than depending on driver behaviour.

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
