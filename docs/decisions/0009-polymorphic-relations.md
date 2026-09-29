# 0009 — Polymorphic relations

- **Date:** 2026-09-29
- **Status:** accepted
- **Proposal:** `schema-polymorphic-relations.md` (local working artifact, not tracked)

## Context

The API layer in front of the client exposes GraphQL unions and interfaces, and relations to them:

- a feed mixing rows from several tables;
- a reference whose target is one of several tables;
- a top-level query over an interface.

A dsqlbase relation targeted exactly one table. None of these could be declared, and so none
could be joined, ordered or paged across members in SQL. Merging N single-table reads in
JavaScript works, but it over-fetches every member, cannot paginate by keyset across members,
and has no way to express "belongs to one of".

## Decision

- **Declaring.** `union({ photos, videos })` is a schema node (`Kind.UNION`): a set of member
  tables keyed by schema alias, with no DDL.
  - The key is checked against the alias when the client is built, so a member key means the
    same thing as `$$meta.key` and a node key.
  - `union.columns` holds the **shared fields**: the fields every member declares with the same
    data type. A mismatched field is dropped rather than refused.
- **Relating.** `hasMany`, `hasOne` and `belongsTo` accept a union target.
  - `to` is either shared fields, which resolve per member, or one column list per member.
  - A belongs-to a union names a `discriminator`: the source text column holding the member
    alias. It is required there and refused anywhere else.
  - The registry validates every member's pairs.
- **One `UNION ALL` builder** behind joins and the top-level client.
  - Each member is a branch built through `_resolveSelectParams` on the member's own table.
    Tenancy, codec-aware filters and nested joins therefore apply per branch, and no branch can
    skip the `WHERE` seam.
  - Each branch is wrapped as `row_to_json(...) AS "data"` plus carried hidden columns, since
    members share no column list. It projects its alias as a `'<alias>' AS "$$key"` literal
    (`sql.literal`).
- **Ordering and limits.**
  - Rows are ordered by shared keys (hidden `__o<n>`), then `$$key`, then the primary key by
    position (`__pk<n>`) when every member's key has the same arity and types. That makes the
    order total.
  - With a `limit`, each branch is also ordered and limited to `limit + offset`. This is valid
    because every branch sorts by the combined order.
  - With every member pruned, no SQL is emitted for that level.
- **`$$key` is the discriminant, at the top level of every union row**, set by a `UnionResolver`
  that dispatches each row to its member's resolvers before any field is read. It is not
  `$$meta.key`, which TypeScript cannot narrow on ([0007](./0007-global-ids.md)). Ordinary rows
  never get it.
- **GraphQL vocabulary for arguments.**
  - The shared level takes `select` / `where` / `orderBy` / `limit` / `offset`, over shared
    fields only.
  - `on: { [alias]: true | false | { select, where, join } }` is the per-member fragment. The
    same `OnSelectionOf` is widened from `select` only and taken by
    `$findByGlobalId` / `$listByGlobalId`, which forward `where` and `join`.
- **`$$key` as a pseudo-field** in the shared `where` (`eq` / `neq` / `in` / bare value) and
  `orderBy`. The normalizer folds it per member, where the alias is a constant, so a member that
  cannot match produces no branch and a decided condition never reaches SQL. It narrows the
  query, not the result type; `on: { alias: false }` narrows both.
- **A read-only `UnionClient`** under each union's alias: `findOne` / `findMany` / `paginate` /
  `count`.
  - Pages reuse the cursor codec and `shapePage` from [0008](./0008-client-pagination.md), signed
    over the union alias and the total order.
  - The keyset is applied inside each branch; `before` reverses every order, pushdown included.
  - Paging requires aligned member keys.
  - `count` adds one `count(*)` per member.
  - A union is visible on a client only when every member is.
- **Polymorphic belongs-to.**
  - **Joining:** each branch also requires `discriminator = '<alias>'`, rendered in the parent's
    scope.
  - **Declaring the id:** the `from` column is a keyless `guid()` bound to a **dynamic node key**
    read from the discriminator, the form [0007](./0007-global-ids.md) deferred here.
  - **Reading:** core gained a guid-agnostic seam. A built `Column` may carry a `rowDecoder`
    (`dependsOn` + `decode(raw, row)`), which `_resolveFields` resolves through a `MetaResolver`
    after projecting the dependencies. The client sets it, so global ids stay out of core.
  - **Writing and filtering:** writes fill the discriminator from a global id. Filters on a
    global id become `(discriminator = key AND id = pk)`.

### Rejected alternatives

- **Base table + typed child tables** (schema-level polymorphism). Every row gets two node
  identities, every write touches two tables and every read needs a join. It stays available by
  hand with single-target relations.
- **N single-target relations + a JavaScript merge.** It has no cross-member `LIMIT` / `OFFSET`
  in SQL, since each branch over-fetches. It cannot keyset-paginate across members and has no
  form for "belongs to one of".
- **A database view over `UNION ALL` as a single-target relation.** `ViewDefinition` is a stub,
  the migration module would own view DDL, and members' columns must be NULL-padded, losing the
  per-member shape. The per-branch resolver and types are needed anyway.
- **A key column declared on the column** (`guid(name, { keyColumn })`). That puts a relation
  concern inside a column definition; the relation owns the discriminator instead.
- **One nullable key column per member** (an exclusive arc). The table gets wider, and it needs
  a virtual field to present one id. It is achievable today with single-target relations.
- **No discriminator, probing every member by id.** That costs N probes per row, the id cannot
  be wrapped on read, and writes cannot be validated.
- **A declared shared-field list on `union()`.** It would be redundant with the intersection;
  validating an interface's field list is the GraphQL layer's job.
- **`$$meta.key` as the discriminant.** It does not narrow ([0007](./0007-global-ids.md)).
- **Rendering `$$key` conditions into SQL** (`'videos' = 'videos'`) and leaving the planner to
  fold them. That emits branches that can never match. Folding in the normalizer prunes them
  first.
- **A post-processing hook for dynamic-key wrapping.** [0004](./0004-record-meta.md) rejected
  such hooks. The row decoder is a `MetaResolver`, the resolver kind set aside for a value
  computed from the row.

## Consequences

- **Breaking, in `@dsqlbase/core`.**
  - `FieldRelation.target` widens to `AnyTableDefinition | AnyUnionDefinition`.
  - `FieldRelation.to` widens to `RelationTargetColumns`, and `getRelationTarget` returns
    `AnyTable | Union`.
  - `JoinParams` becomes `TableJoinParams | UnionJoinParams`, and `FieldResolver` may hold a
    `UnionResolver`.
  - `RelationsDefinition.toJSON` serializes a union target, a per-member `to` and a
    `discriminator`.
  - `Kind` gains `UNION` / `UNION_COLUMN`, `Schema` gains `unions`, `Column` gains `dataType` /
    `rowDecoder` / `resolveRow`, and `CountOperation.args` widens.
- **Breaking, in `dsqlbase`.**
  - `OnSelectionOf` entries widen to `{ select, where, join }`.
  - `Aliases` / `VisibleAliases` / `Models` include unions.
  - A keyless `guid()` on the `from` side of a discriminated belongs-to is no longer bound as a
    self reference.
- **Stricter than the proposal on guid pairs.** A discriminated `from` column is a keyless
  `guid()` with node members, or `uuid()` throughout; a mix throws, as for any relation.
- **Reverse relations.** A has-many from a member back onto the polymorphic column is allowed,
  and it correlates on the id alone.
- **No foreign key** can back a polymorphic `from` column.
- **`paginate` needs aligned member keys**; a union whose keys differ reads with `findMany` and
  `offset`.
- **Carried debts closed:**
  - `on` carrying only `select`;
  - the dynamic node key from [0007](./0007-global-ids.md);
  - hidden keyset keys being root-level only, now projected per branch for a union read at the
    root.
- **Isolation specs cover union joins and the union client**, including `count` and pages. They
  fail with the tenant predicate disabled, as the dispatch specs do with dispatch disabled and a
  colliding-key spec does with the discriminator correlation removed.
- **Changeset level:** `minor`, one changeset per story.

## Docs

- [Polymorphic relations (guide)](../guide/polymorphic-relations.md) — the whole feature from a
  consumer's side.
- [Relations](../guide/relations.md), [Schema](../guide/schema.md), [Querying](../guide/querying.md),
  [Pagination](../guide/pagination.md), [Tenancy](../guide/tenancy.md),
  [Transactions](../guide/transactions.md), [Global ids](../guide/global-ids.md).
- [Runtime pipeline](../internals/runtime-pipeline.md) — union joins, the total order, dispatch,
  `$$key` folding.
- [Codec boundary](../internals/codec-boundary.md) — the row decoder.
- [Architecture](../internals/architecture.md) — new files.
