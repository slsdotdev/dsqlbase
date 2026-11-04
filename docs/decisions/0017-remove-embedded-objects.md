# 0017 — Remove embedded objects

- **Date:** 2026-11-04
- **Status:** accepted
- **Supersedes:** [0013](./0013-embeddable-objects.md)
- **Proposal:** `schema-definition-cleanup.md` (local working artifact, not tracked)

## Context

[0013](./0013-embeddable-objects.md) added `embedded()` value objects placed in a table as
column groups. The API surface was small, but it changed the model underneath it.
`Table.getColumn` could return a group. `ColumnRefs` and the index, constraint and primary-key
callbacks took nested refs. `FieldSelection` and `FieldMutation` gained group forms. The filter
and `orderBy` builders recursed into groups, and about twenty client types grew a group arm.
That made every later change to the runtime pipeline harder to reason about, for a feature a
consumer can get with plain prefixed columns or a `jsonb()` column with `.schema()`.

## Decision

- Remove `embedded()`, `EmbeddedObjectDefinition`, `ColumnGroupDefinition`, the runtime
  `ColumnGroup`, and every generalisation made for them:
  - `getColumn` returns `Column | undefined` again;
  - `ColumnRefs` is flat;
  - `FieldSelection` / `FieldMutation` have no group form;
  - the filter and order builders, and the client types, are column-only.
- Keep what shipped alongside 0013 but does not depend on groups:
  - `$onUpdate` runs on every update, validated and encoded like any write;
  - the `DUPLICATE_SEQUENCE_NAME` migration rule;
  - the reserved nested `where` inside a field's filter, now reserved for `jsonb` only.

## Consequences

- **Breaking:** `embedded` is no longer exported from `dsqlbase/schema`, and the group types are
  gone from `@dsqlbase/core`. A schema that used a group must declare its prefixed columns
  directly. The migration sees the same columns, so the database does not change. Changeset
  level **minor** (0.x).
- A value object that has to be indexable is written as prefixed columns. One that does not is a
  `jsonb()` column with `.schema()` ([0011](./0011-json-columns.md),
  [0012](./0012-json-array-record.md)).

## Docs

- `docs/guide/embeddable-objects.md` is deleted.
- Group passages are removed from:
  - `docs/guide/`: `schema.md`, `querying.md`, `pagination.md`, `global-ids.md`, `migrations.md`
  - `docs/internals/`: `runtime-pipeline.md`, `codec-boundary.md`, `architecture.md`
