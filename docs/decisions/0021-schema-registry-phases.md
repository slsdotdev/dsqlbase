# 0021 — Schema registry phases

- **Date:** 2026-11-05
- **Status:** accepted
- **Proposal:** `schema-registry-split.md` (local working artifact, not tracked)

## Context

`SchemaRegistry` validated, built and stored in one pass. Its relation checks also resolved
runtime columns, created computed discriminators and set column references, and it kept
build-time scratch (`_unionPairs`, `_discriminators`, `_computed`, a map of cloned union-source
relations) as state, so later steps of construction — and three lookup methods — could find what
validation had made. Relations stayed definitions at runtime, so every join re-resolved columns by
name and asked the registry three questions (`getRelationTarget`, `getUnionRelationColumns`,
`getRelationDiscriminator`).

## Decision

Three steps, each with one job:

1. **`validateSchema(definition)`** (`packages/core/src/definition/validate.ts`) — pure checks
   over definitions. It builds nothing, keeps nothing, and throws the first problem with the same
   messages as before. It also refuses a relation through a deprecated column, which the client
   cannot read and which previously failed while building.
2. **`buildSchema(definition)`** (`packages/core/src/runtime/build.ts`) — builds tables, unions
   and one `RuntimeRelation` per table and field (runtime columns on both sides, the runtime
   target, per-member columns and discriminator for a union target), then links every column
   reference from those relations in one place. It checks nothing, and nothing it uses outlives
   the call. A relation declared on a union becomes one `RuntimeRelation` per member
   (`declaredOn` is the union); no definitions are cloned.
3. **`SchemaRegistry`** — lookups only: tables, unions, `claimKeys`, and
   `getRelation(table, field)` / `getRelations(table)`.

A runtime `Table` no longer holds relations; `ColumnReference.via` is the `RuntimeRelation`.

## Alternatives considered

- **Collect every error rather than throw the first.** Better for a large schema, but every
  test asserts one message; left for later.
- **A separate branch after #38.** #38 introduced most of the state this removes, so it lands
  there.

## Consequences

- Validation is testable against definitions alone; `buildSchema` assumes valid input.
- Joins, the normalizer and `nodes.ts` read resolved relations directly.
- **Breaking (`@dsqlbase/core`):** `getRelationTarget`, `getUnionRelationColumns`,
  `getRelationDiscriminator` and `hasRelations` are removed; `getRelations` returns
  `RuntimeRelation`s; `Table.relations` / `getRelation` / `hasRelation` are removed and the
  `Table` constructor is `(definition, alias?)`; `ColumnReference.via` is a `RuntimeRelation`.

## Docs

`docs/internals/runtime-pipeline.md` (Relations and joins, Column references, Union joins),
`docs/internals/architecture.md`.
