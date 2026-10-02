# 0012 — Column validators, `jsonb` operators, and `array()` / `record()` on `jsonb`

- **Date:** 2026-10-02
- **Status:** accepted
- **Proposal:** `json-array-record.md` (local working artifact, not tracked)
- **Amends:** [0011](./0011-json-columns.md) — where validation runs, and two of its deferred items

## Context

`0011` deferred two things to this item:

- rebuilding `array()`, which stored `string[]` comma-joined in `text` and lost data (`["a,b"]`
  read back as `["a","b"]`, `[]` as `[""]`);
- a `record()` for objects.

It had reserved runtime types `array` and `object` for them, with `contains` meaning `@>`.

Grooming found a flaw in `0011` that blocked both. `.schema()` put validation **inside the
codec**, so every caller of `encode` validated, filters included: the normalizer builds every
filter parameter with `Column.param()`, which encodes. That was harmless while a JSON column took
only `exists`, but a containment filter takes a _fragment_:

- `{ contains: [{ id: 1 }] }` fails a full item schema, or has defaults filled in and matches
  other rows;
- `Column.param()` in raw SQL validated as a side effect.

The author's call was that a codec should not be validating at all. Per the rules, the fix was a
prerequisite story, not something to design around.

## Decision

### Validation is a column step, not part of the codec

- **Core** gains an optional, library-agnostic `ColumnValidator { write, read }`
  (`ColumnConfig.validator`, `Column.validator`):
  - writes (insert, update, `$onCreate`, `$onUpdate`, `.default()`) run `write`, then `encode`;
  - reads (root, joined, and through a row decoder) run `decode`, then `read`;
  - filters and `Column.param()` only encode;
  - `NULL` reaches neither.
- **A codec translates and nothing else.** `ColumnCodec` is back to `<TRaw, TValue>`, and
  `Column.param` takes the value type. `inputType` is what writes and the validator take.
- **`.schema()` installs a validator.** The Standard Schema adapter, the stability check and
  `ColumnValidationError` stay in `dsqlbase`.
- **Filters compare literally.** A filter value is never validated and gets no defaults:
  `eq: { kind: "list" }` does not match a stored `{"kind":"list","columns":3}`. This is the rule
  for every column.

### `jsonb` has its own runtime type

`jsonb()` is runtime type `jsonb`, apart from `json`, which keeps `exists` only and is still
refused by `distinct`, since Postgres's `json` has no equality.

### `array()` and `record()` are thin wrappers over `jsonb`

- Both are `JsonColumnDefinition`s, data type `jsonb`, with runtime types `array` / `object`.
- **The shape is always checked.** The validator requires an array, or a plain object (so a
  `Date` or a `Map` is refused):
  - on writes, after the schema, on what will be stored;
  - on reads, before the schema;
  - with or without `.schema()`.
- **No `.of()`.** `.schema()` takes the whole value's schema. `JsonSchemaFor<this>` constrains
  it by the column's runtime type, so the types refuse a schema whose output is not an array (or
  an object).
- **`$type<T>()` stays type-only.**
  - On `array`, `T` may be the item type or the array type: core's `TypeArgOf` wraps a non-array
    `T`, so `$type<string>()` and `$type<string[]>()` both give `string[]`.
  - On `record`, `T` is used exactly as passed.
- **Untyped columns** read and write as `unknown[]` / `Record<string, unknown>`. The client's
  `ValueTypeOf` / `InputTypeOf` present them that way, while the column's own value type stays
  `unknown`, so that `$type` gives exactly `T`.

### Operators

| Runtime type     | Operators                                   |
| ---------------- | ------------------------------------------- |
| `json`           | `exists`                                    |
| `jsonb`, `array` | `eq`, `neq`, `contains`, `exists`           |
| `object`         | `eq`, `neq`, `contains`, `hasKey`, `exists` |

None of these takes a bare value or can be an `orderBy` key; `distinct` compares all but `json`.

- **`contains` is `@>`** (`sql.jsonbContains`). It matches recursively: objects by the keys the
  fragment names, at any depth, and arrays as a subset in any order.
  - It is typed as `JsonFragment<V>`, a deep partial: never `null`, and anything on an untyped
    `jsonb`.
  - It is encoded and never validated.
  - On `array` the fragment is always an array of items. A lone item throws, because it would
    be ambiguous when the items are themselves arrays.
- **`eq` / `neq`** compare whole values as Postgres compares `jsonb`: object keys in any order,
  array items in order.
- **`hasKey`** (`sql.jsonbHasKey`, `?`) is on `object` only. On an array or a scalar, `?` also
  matches string elements, which is a different meaning. Its key is sent raw, since it is not a
  value of the column.
- **PGlite resolves `col @> $1` and `col = $1` without a `::jsonb` cast.** This is not verified
  on DSQL itself.

### Rejected alternatives

- **Keeping validation in the codec** and having filters skip the codec for fragments. That
  patches one caller; every other `encode` caller would still validate.
- **`.of(itemSchema)`** on `array()`. It would be two ways to say the same thing; `.schema()`
  with the library's own array schema is enough.
- **`containsAny`.** `or` over several `contains` filters does the same.
- **Validating or default-filling filter values**, so that `eq` matched stored defaults. Filters
  compare with what is stored, as given, on every column.
- **A database `CHECK (jsonb_typeof(col) = 'array')`.** Reads already validate the shape, and it
  would be one more thing for the stale planner to diff.
- **`ArrayColumnDefinition` / `RecordColumnDefinition` subclasses overriding `$type` and
  `.schema()`.** A different return type or a narrower constraint makes the column unassignable
  to `AnyColumnDefinition`. The rule moved into the base methods, keyed on the runtime type.
- **`unknown[]` as the array column's own value type.** `$type<string>()` then produced
  `unknown[] & string[]`.
- **A compatibility alias for the text-backed `array()`.** It loses data.
- **`hasKey` on `array` / `jsonb`.** See above.

## Consequences

- No filter value is validated by any column's schema, so a fragment reaches the database as
  given.
- `jsonb`, `array()` and `record()` values cannot be indexed in DSQL, so every JSON filter scans.
- **Migrating an existing `array()` column is not handled.** DSQL has no
  `ALTER COLUMN … SET DATA TYPE`, so the planner refuses the `text → jsonb` change
  (`IMMUTABLE_COLUMN`), and that refusal is correct.
  - The manual path is to add a new column, backfill it with
    `to_jsonb(string_to_array(old, ','))`, then switch the field.
  - The planner cannot do this today: it refuses `DROP COLUMN` (a stale refusal) and has no
    rename detection.
  - This belongs to the migrations work, since the whole planner is stale.
- **Breaking, in `@dsqlbase/core`:**
  - `ColumnRuntimeType` gains `jsonb`;
  - `$type<T>()` returns `ValueType<this, TypeArgOf<this, T>>`;
  - `ColumnConfig` gains `validator`.

  `ColumnCodec`'s third type parameter from `0011` never shipped; its unreleased changeset was
  corrected.

- **Breaking, in `dsqlbase`:**
  - `array()` is `jsonb` and `unknown[]` untyped;
  - `jsonb()` is runtime type `jsonb`;
  - `FilterOf` types `contains` per runtime type (`ContainsValueOf`);
  - the operators gain `hasKey`.
- Changeset level `minor`.

### Deferred

- Nested `where` into documents, and `some` / `every` over items.
- Length and emptiness operators.
- Migrating text-backed `array()` columns (the migrations work).
- Checking that `@>` and `=` need no cast on DSQL.

## Docs

- [Codec boundary](../internals/codec-boundary.md) — validators: where they run, and why not in
  the codec.
- [Runtime pipeline](../internals/runtime-pipeline.md) — `contains` and `hasKey` per runtime type.
- [Schema (guide)](../guide/schema.md) — `array()`, `record()`, filters not validated.
- [Querying (guide)](../guide/querying.md) — operators for `jsonb`, `array`, `object`.
- [Architecture](../internals/architecture.md) — `schema/utils`.
