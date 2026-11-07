# 0023 — One-row `update` / `delete`, and `updateMany` / `deleteMany`

- **Date:** 2026-11-07
- **Status:** accepted
- **Supersedes:** the "change every matching row but return one" known gap in
  [Runtime pipeline](../internals/runtime-pipeline.md)
- **Proposal:** `row-policies.md`, prerequisite story (local working artifact, not tracked)

## Context

`update` and `delete` built with mode `"one"` and no row limit: they changed every row the
`where` matched and returned the first. A caller who meant one row and wrote a loose filter
changed many without knowing; one who meant many got one back. Row policies throw from a
`RETURNING` expression evaluated on every affected row, so their errors had to be specified
against an API that says how many rows a write touches.

Three fixes were open: require a unique `where`, add `updateMany` / `deleteMany`, or count the
affected rows and throw on more than one. Counting needs the statement to have run — on DSQL,
outside a transaction, it has already committed.

## Decision

- `update` / `delete` change one row. Their `where` must compare every field of one unique key
  for equality with a non-null value, at the top level or inside `and`; conditions beside it are
  allowed. `or`, `not`, `in`, `neq` and `null` pin nothing (a unique column admits many `NULL`s).
  Refused when the query is built, by `WhereBuilder.buildUnique`.
- `updateMany` / `deleteMany` take the same arguments, change every match, and return every
  returned record. They still refuse an empty `where`.
- Unique keys are core's: `Table.uniqueKeys` (primary key, unique columns, unique constraints,
  non-partial unique indexes over plain columns), moved from the global-id node discovery, which
  now reads it.
- The rule is runtime-only. A type-level unique `where` would need the key sets as types; not
  worth it yet.

## Consequences

- **Breaking (`minor`):** an `update` / `delete` whose `where` does not pin a unique key now
  throws; switch it to `updateMany` / `deleteMany`. A table with no unique key has no one-row
  write at all.
- The rule lives in the client. A direct `OperationsFactory` caller still chooses its own mode.

## Docs

- [Querying](../guide/querying.md#model-methods)
- [Runtime pipeline → One-row and many-row writes](../internals/runtime-pipeline.md#one-row-and-many-row-writes)
