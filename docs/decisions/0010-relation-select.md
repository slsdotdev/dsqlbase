# 0010 — Relations in `select`

- **Date:** 2026-09-30
- **Status:** accepted
- **Proposal:** `client-runtime-joins.md` (local working artifact, not tracked), narrowed at
  re-draft

## Context

A read's `select` took columns only, so taking one field from a related row needed two keys
saying one thing: `select: { id: true }, join: { project: { select: { name: true } } }`. A
GraphQL selection set, which is what the API layer in front of the client produces, is a single
tree of fields and relations, and mapping it meant splitting every level into `select` and
`join`.

The proposal behind this record was broader: ad-hoc joins to undeclared targets, filtered
relations under a second key, `count` joins, and a callback `where` with column references. Its
column-reference design threaded a scope through the normalizer, which
[0003](./0003-select-tree-aliasing.md) had rejected, so it needed re-drafting before it could
start. At the re-draft the author narrowed it to the `select` form alone; the rest is deferred
(below), with its reasoning kept here.

Separately, the types and the runtime disagreed on an empty select: `select: {}` and an
all-`false` select were typed `{ $$meta }`, while the runtime returned every column.

## Decision

- **A relation may be named in `select`**, as `true` or a field map over its target. The map
  may name the target's relations in turn. A relation to a union takes the union's shared
  fields.
- **It is read exactly as the same relation in `join`.** `RequestNormalizer._getReadSelection`
  merges it into `join`, as `true` or `{ select: map }`, before anything else runs. Union
  arguments, polymorphic correlation, tenancy and core therefore see one join form, and the SQL
  and result type are identical. The selected relations come ahead of the caller's own `join`
  entries, so a result's keys follow the call as written.
- **`join` is unchanged.** It is where a relation's `where`, `orderBy`, `limit` and `offset`
  go. A select field map takes fields only.
- **One relation truthy in both `select` and `join` is refused.** It is a type error at the
  call (`NoSelectJoinOverlap`, top level only) and throws when the query is built, at any
  depth. A falsy `join` entry beside it is ignored.
- **Which columns come back:**
  - no `select`, or one naming nothing as `true`, returns every column, as the runtime already
    did; the types now say so, for a write's `return` too;
  - naming columns returns those columns;
  - naming only relations returns only the relations, with no columns of the row itself.
- **Core carries the difference.** `SelectOperationArgs.select` is optional: omitted means
  every column, `[]` means none. The normalizer sends `[]` only for a relation-only select.
- **`on.<alias>.select`** on union joins, `UnionClient` and the global-id lookups takes the
  member's relations the same way. A write's `return` takes columns only.

### Rejected alternatives

- **"`select` names exactly what comes back"**, where an empty select would throw. It was
  considered at the re-draft and rejected by the author: `{}` keeps returning every column, and
  the types follow the runtime.
- **Query arguments inside a select field map** (`select: { members: { where, … } }`). That gives
  two places to write the same thing, and a key like `where` could collide with a field name.
- **Merging a relation named in both `select` and `join`.** Whatever precedence rule was chosen
  would be invisible where the query is read.
- **Relations moved into `select`, with `join` repurposed for ad-hoc entries.** This breaks every
  `join:` caller.
- **Schema-time filtered relations** (`hasMany(t, { where })`). They bake a query concern into
  the definition and cannot be parameterised.
- **Virtual or computed fields in `select`** (`select: { n: sql`…` }`). They need a typed `sql<T>`,
  and raw SQL would bypass the tenant seam. They are a topic of their own.
- **String markers for parent columns** (`"$parent.id"`). They collide with real string values,
  and they are untyped.
- **A Kysely-style query builder.** It is a second query language beside the model client, and
  it bypasses tenancy. `$query` with the `sql` tag remains the raw escape hatch.
- **Inferring join cardinality from unique constraints.** It is fragile, and invisible when
  reading a query.

### Deferred

These were in the original proposal and are not scheduled. The reasoning to start from:

- **Filtered relations** (`join: { active: { relation: "members", where } }`): the same
  relation under a second key with another filter. This is the most frequent need, and the
  cheapest next step, since the correlation still comes from the schema and no scope design is
  needed.
- **`count` joins** (`type: "count"`): a `count(*)` lateral with no JSON wrapper, resolving to a
  `number` with no `$$meta`. They pair naturally with filtered relations.
- **Ad-hoc entries** (`{ from: "<alias>", type: "one" | "many", where }`): an undeclared target.
  They need parent references, and a check that an entry references the parent row, since an
  uncorrelated lateral silently returns every row for every parent.
- **Callback `where` with column references** (`(self, parent) => where`). A design that fits
  builder-owned aliasing:
  - a `self` reference is the plain `Column` node, which already renders under the innermost
    scope, provided an `SQLNode` value skips codec encoding;
  - a `parent` reference needs a marker node that `QueryBuilder` resolves in the parent's scope,
    the same mechanism `_buildCorrelation` uses for the parent-side column.

  Open questions for when it is picked up:
  - whether a union's shared `where` takes a callback;
  - whether an ad-hoc `from` is limited in the types to the aliases visible on the client;
  - what a `TParent` generic on `QueryArgs` costs at type level.

  Switching `PaginateArgs.where` / `CountArgs.where` to the callback form goes with it.

- **[0003](./0003-select-tree-aliasing.md) concerns 2 and 4** stay open, since this record adds
  no handle on a level. The recommendation carried forward:
  - affirm unconditional aliasing (concern 2), because references and union branches both rely
    on every level having an alias;
  - answer the missing aliasing API (concern 4) with `(self, parent)`, with no user-named scopes.

## Consequences

- A GraphQL selection set maps onto `select` level by level; per-field arguments map onto
  `join`.
- **Breaking, in `@dsqlbase/core`:** `SelectOperationArgs.select: []` means no column, where it
  used to mean every column.
- **Breaking, in `dsqlbase`:**
  - the result type of an empty or all-`false` `select` or `return` is the full row;
  - a read's `select` is typed `SelectionOf<T, S>`, while `FieldSelectionOf<T>` stays the type
    of `return`;
  - a `join` key set to `false` is no longer in the result type.
- **The overlap check is shallow in the types.** A nested level naming a relation in both places
  compiles, and throws when built.
- Isolation is covered: a spec reaches a tenant table through a relation in `select`, including a
  union member, and fails with the tenant predicate disabled.
- Changeset level `minor`.

## Docs

- [Querying (guide)](../guide/querying.md) — which columns come back, and relations in `select`.
- [Relations (guide)](../guide/relations.md), and
  [Polymorphic relations (guide)](../guide/polymorphic-relations.md) — a union relation in
  `select`, and `on.<alias>.select`.
- [Runtime pipeline](../internals/runtime-pipeline.md) — how the split is converted into `join`
  entries, and the empty-selection rule.
