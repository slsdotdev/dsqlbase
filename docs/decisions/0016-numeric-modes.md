# 0016 — `numeric()` read modes

- **Date:** 2026-10-11
- **Status:** accepted
- **Proposal:** `numeric-modes.md` (local working artifact, not tracked)

## Context

`numeric()` decoded every value with `parseFloat`. A `numeric(38,10)` holds far more significant
digits than a double, and money arithmetic on doubles drifts, so reads were lossy even though the
database hands the codec exact text at every depth — root reads directly, joined and union rows
through `::text` (see [0015](./0015-release-readiness.md)). The only lossy step was the decode.

## Decision

- `numeric(name, { mode })` takes `"number"` (default, unchanged), `"string"` (the exact text) or
  a **decimal class**: any `new (value: string) => T` whose `T` has `toString()` and `toJSON()`
  (`DecimalConstructor` / `DecimalLike`). decimal.js, big.js and bignumber.js fit; dsqlbase takes
  no dependency on any of them.
- The read type follows the mode; writes also accept a `string` or `number` in `"string"` and
  class modes, converted to the read form by the write validator before precision and scale are
  checked. A string that is not a decimal number is refused.
- `runtimeType` stays `number`: it names the database value's kind, so the operators and the
  value shorthand are unchanged. Filters take the read type and encode it with `String(value)`.
- The mode is runtime-only; it changes no DDL and no migration.

## Consequences

- Exact reads and writes for any precision, in the consumer's decimal library of choice.
- `number` mode is still the default, so nothing breaks: changeset level **patch**.
- A decimal class whose `toString()` prints something Postgres cannot read as `numeric` fails at
  the database, not at the column.

## Docs

- [Schema → Numeric columns](../guide/schema.md#numeric-columns)
- [Querying → Operators by column type](../guide/querying.md#operators-by-column-type)
- [Codec boundary](../internals/codec-boundary.md#joined-and-union-rows-exact-types-travel-as-text)
