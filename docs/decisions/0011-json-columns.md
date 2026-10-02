# 0011 — JSON columns and operators by runtime type

- **Date:** 2026-10-01
- **Status:** accepted
- **Proposal:** `json-columns.md` (local working artifact, not tracked), re-scoped from
  `schema-embeddable-objects.md`

## Context

The queue's last item was embeddable objects: `object()` value objects flattened into columns,
and typed `jsonb` documents. Reviewing it against what had shipped since it was drafted surfaced
too many open points to build at once, so the author narrowed it to `jsonb`. Three problems came
with that:

- **There was no `jsonb`**, and `json()`'s `$type<T>()` was a cast: nothing checked a document,
  so the type was not a promise.
- **Filters on a `json` column built SQL Postgres rejects.** Its value type was `unknown`, so
  the types accepted anything, and the normalizer applied the generic operators — `LIKE` for
  `contains`, `=` for `eq`, neither of which `json` has. The value shorthand was ambiguous:
  `{ settings: { eq: 1 } }` is either the operator or the document `{"eq":1}`.
- **A type-only flag would not fix it.** `guid: true` constrains the types; the runtime still
  builds whatever it is given.

Two latent bugs surfaced on the way: the JSON decode parsed values the driver had already
parsed (a stored JSON string `"123"` read back as the number `123`), and a field filter with
several operators kept only the first (`{ gte: 1, lte: 5 }` dropped `lte`).

## Decision

### A runtime type on every column

- `ColumnConfig.runtimeType` (core) names the kind of value a column holds **for querying**, not
  its JavaScript form: `string`, `uuid`, `number`, `bigint`, `boolean`, `date`, `interval`,
  `bytes`, `json`, with `array` and `object` reserved. Every builder sets it; a domain carries
  it to its columns. `uuid` is its own type because `LIKE` on a uuid is a Postgres error;
  `time` and a `date()` read as a string are `date`.
- **One table** in the client (`packages/dsqlbase/src/client/model/operators.ts`) decides, per
  runtime type, the `where` operators, whether a bare value means `eq`, whether the column can
  be an `orderBy` key, and whether `distinct` can compare it. The filter types and the normalizer
  both read it, so the runtime refuses exactly what the types refuse, before SQL is built — for
  a caller the types cannot see, such as a resolver passing arguments through. This is the
  Drizzle approach: a fixed set of value kinds that narrows operators and is enforced at runtime.
- **`contains` keeps one meaning per column.** On `string` it is `LIKE`; on the reserved `array`
  / `object` types it will be `@>`. Different types may give one name different meanings; a
  given column never does, and the runtime checks which it is.
- **JSON, binary and the current `array()` take no bare value** and filter by `exists` only,
  for now — although DSQL supports every Postgres JSON operator.
- **`where` is reserved** inside a field's filter as the nested-filter operator: for a `jsonb`
  path now (`settings->'theme' = $1::jsonb`, no casts) and for embedded members later. Operators
  are a closed set per runtime type, so a document key or member called `eq` or `exists` only
  ever appears inside the nested `where`, which removes the collision the embeddable-objects
  review raised. Reserved only: it throws until built.
- Several operators on one field all apply, AND-ed; an unknown operator name throws.

### `jsonb()` and `.schema()`

- **`jsonb(name)`** sits beside `json(name)`: any JSON value — object, array, string, number,
  boolean — with `null` as SQL `NULL`, never a JSON `null`. Both are runtime type `json`.
- **The decode does not parse.** Both supported sessions return JSON columns parsed, and a
  joined row arrives inside parsed JSON, so the codec receives a value. A custom `Session` must
  do the same.
- **`.schema(s)`** on `json()` and `jsonb()` takes any Standard Schema (types vendored, no
  dependency) and validates every write and every read:
  - a **write** validates, stores the schema's **output** in its JSON form, validates that
    stored form again and requires it to serialize identically — the **stability check**;
  - a **read** validates the stored value and returns the output.

  Defaults and coercions pass the check and are stored; a transform fails it on the first write
  that reaches it. A schema that answers with a `Promise` throws, since a codec is synchronous.
  Failures throw `ColumnValidationError` (`code`, `column`, `phase`, `issues`).
  **Amended by [0012](./0012-json-array-record.md):** this validation ran inside the codec, so
  filters were validated too. It is now a column validator, run on writes and reads only.

- **Writes and reads have their own types.** `ColumnConfig.inputType` (defaulting to the value
  type) is what `create`, `update`, `.default()`, `$onCreate`, `$onUpdate` and `Column.param`
  take; a read returns `valueType`. With a schema they are its input and output.

### Rejected alternatives

- **Storing the value as given** and applying defaults on read. Column defaults and schema
  defaults would disagree, and a filter would not see a defaulted field.
- **Validating on write only.** The read type would not be a promise.
- **Introspecting the schema to detect transforms** (zod's internals). It ties the column to one
  vendor; Standard Schema exposes only `validate`, `vendor`, `version` and compile-time types.
- **A `json: true` type flag** to choose the filter type. Type-only; the runtime would still
  build the invalid query.
- **New operator names for containment** (`includes`, `jsonContains`). Superseded once the
  runtime type decides what `contains` means on a column.
- **One builder for value objects and documents, with a storage flag.** From the embeddable
  review: the two storages differ in filters, nullability, indexing and migration.

## Consequences

- A filter on any column is checked against its type at runtime, not only in the types.
- `jsonb` values cannot be indexed in DSQL, so `exists` and any later JSON filter scan.
- The stability check costs a second validation per write, and catches a transform on an
  optional path only when a write reaches it.
- **Breaking, in `@dsqlbase/core`:** `ColumnConfig` gains `runtimeType` and `inputType`,
  `DomainConfig` `runtimeType`, `ColumnCodec` a third type parameter; the write-side methods
  take the input type. (`0012` removed `ColumnCodec`'s third parameter before a release.)
- **Breaking, in `dsqlbase`:**
  - `json`, `array()` and `bytea` columns filter by `exists` only, take no bare value, and
    cannot be ordered by; pattern operators are refused off `string`, ordering operators off
    `boolean`; `distinct` refuses a selected JSON column (`jsonb` included, for now);
  - `CreateValuesOf` / `UpdateValuesOf` use the input type;
  - a JSON column's decode returns what the session returned.
- Changeset level `minor`.

### Deferred

- **Nested `where`** into a `jsonb` document.
- **A `jsonb` runtime type of its own**, when `jsonb` gains `eq` and `@>`, which `json` cannot
  have; it would also let `distinct` accept `jsonb`. **Resolved by
  [0012](./0012-json-array-record.md).**
- **Separate read and write types for transforming schemas**, should transforms be wanted.
- **`array()` and a `record()` rebuilt on `jsonb`**, runtime types `array` / `object`, item
  types enforced by the codec. Today's `array()` stores comma-joined `text` and loses data
  (`["a,b"]` reads as `["a","b"]`, `[]` as `[""]`); the rebuild changes storage, so it needs a
  migration story. **Resolved by [0012](./0012-json-array-record.md)**, the migration left to the
  migrations work.
- **Embeddable objects.** Their review notes, to start the re-draft from:
  - a nullable group read through a partial `select` needs its required leaves projected to
    tell absent from present;
  - a group is shared across a union only when every member uses the same shape instance under
    the same field;
  - relation keys, discriminators, primary keys and tenant claims stay plain columns;
  - re-keying `Table.columns` by path in the public types is the most invasive part, and may be
    avoidable with path-keyed runtime entries and `getColumn(path)`.

## Docs

- [Querying (guide)](../guide/querying.md) — operators by column type.
- [Schema (guide)](../guide/schema.md) — JSON columns, `.schema()`, the stability rule.
- [Runtime pipeline](../internals/runtime-pipeline.md) — the operator table and where it is
  enforced.
- [Codec boundary](../internals/codec-boundary.md) — the driver parses, the codec validates;
  input and value types.
- [DSQL capabilities](../internals/dsql-capabilities.md) — JSON storage, no index support.
