# 0004 — `$$meta` on every result row

- **Date:** 2026-09-22
- **Status:** accepted
- **Proposal:** `schema-prerequisites.md` story 5 (local working artifact, not tracked)

## Context

The result resolver could turn a driver row into an object of decoded columns and nothing else. Its tree was `FieldResolver = [fieldName, AnyColumn | FieldResolver[]]`, where a nested branch is a *bare array*: `_resolveJoinEntries` had the join's target table in hand and discarded it, and `_createResultResolver` was never passed a table even at the top level. So anything per-row that depends on which table a row came from was impossible below the top level.

Both `schema-guid.md` (a `key` discriminant and a per-row `globalId`) and `schema-polymorphic-relations.md` (per-row dispatch, `__typename`) build on such a contract, and neither can be designed until it is fixed. `client-pagination.md` wants a third thing in the same place, `$$meta.cursor`.

## Decision

- **`$$meta` on every result record**, at every level: top-level select rows, each joined level, and `return` rows from `create` / `update` / `delete`. It is `{ key, table, schema? }` plus whatever `table().meta()` declared, where `key` is the schema alias and `table` the database name.
- **A third resolver entry kind**, rather than a new tree shape: `MetaResolver = [fieldName, (row) => unknown]` beside the existing column and nested-level kinds. `_createResultResolver` already writes properties from `[name, howToResolve]` pairs; this adds a kind of "how". `FieldResolver`'s nested branch widens to `ResolverEntry[]`; its own meaning is unchanged.
- **One push covers every level.** `_resolveFields` receives the level's table and is called for the top level of a select, each join level, and each `return` selection, so `resolvers.push([META_FIELD, () => table.meta])` reaches all of them. It is pushed first, so `$$meta` leads each record.
- **A `MetaResolver` receives the raw driver row**, before codec decoding — the same row the column branch reads from.
- **`Table.meta` is frozen and built once**, so every row of a level shares one object by reference. `table().meta()` may not redeclare `key` / `table` / `schema`.
- **`$$meta` and `$$key` are reserved field names.** A column of either throws at definition time; a relation of either when the registry is built. `$$key` is reserved ahead of its use by polymorphic relations, because reserving a name costs nothing now and is a breaking change later.

## Rejected alternatives

- **`{ table, fields, post? }` per level, with `post` an ordered list of `(row, raw, table) => void` post-processors** — what the proposal specified. `post` had no consumer in this epic, and its three intended ones do not share a hook: union dispatch decides *which node resolves a row*, so it runs before fields rather than after, and `client-pagination.md` already has its resolver wrapping `_createResultResolver` rather than plugging into it. That leaves one genuine case, which is not a pattern.
- **`{ meta, fields }` per level** — what `schema-guid.md` specified, and smaller than `{ table, … }` since `$$meta` needs the meta object rather than the table. Still restructures a tree that did not need restructuring.
- **A trailing `TMeta` generic on `TableDefinition` and `Table`** — the `WithMeta<T, M> = T & { __type: { meta: M } }` intersection matches how `ValueType` / `NotNull` / `PrimaryKey` already thread refinements through the builders, and needs no new parameter on either class.
- **Non-enumerable or symbol-keyed `$$meta`** — lost on `{ ...row }` and invisible to `JSON.stringify`, both of which consumers do.
- **Spreading user metadata onto the row itself** (`row.__typename`) — collides with the column namespace.

## Consequences

- **Result rows gain a property**, so a whole-row `toEqual` needs `$$meta`. Changeset level `minor`.
- **`post` is not needed later either.** The raw row a `MetaResolver` receives is what `post`'s extra `raw` parameter existed to supply: guid's per-row `globalId` becomes `["$$meta", (row) => ({ ...table.meta, globalId: encode(table, row) })]`, and pagination's `$$meta.cursor` reads the hidden `__k<n>` columns off the same row. Union dispatch is unaffected — it replaces which node resolves a row, so it stays polymorphic's own problem, as it would have been under any design here.
- **`$$meta.key` is typed `string`, not the literal alias**, so a row union does not narrow on it yet. The literal needs the alias threaded as a type parameter, which `TableByName` cannot supply — it looks up by database name, where the alias is a union. `schema-guid.md` designs this and owns the discriminated union that needs it.
- **Two schemas that used to build now throw**: a column or relation named `$$meta` / `$$key`, and a `table().meta()` key colliding with a built-in.
- **No SQL changes.** `$$meta` projects nothing; it is assembled entirely in the resolver.
- **`OnSelectionOf` (proposal story 6) was dropped** rather than shipped here. It is a union-selection type fragment with no method behind it, and this repo tests types through public methods; a test asserting on the type directly would be necessary only because nothing calls it. It moves to whichever feature first ships a method taking `on`, narrowed to `select` for a first cut.

## Docs

- [Runtime pipeline → Result resolution](../internals/runtime-pipeline.md#result-resolution-and-meta) — the three entry kinds and the raw-row guarantee.
- [Querying (guide)](../guide/querying.md#meta-on-every-row) — `$$meta` on every row.
- [Schema (guide)](../guide/schema.md#table-metadata) — `table().meta()` and reserved names.
