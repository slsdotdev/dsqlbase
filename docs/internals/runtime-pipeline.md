# Runtime pipeline

_Audience: contributors and agents._

Every client feature threads through one chain. Know it before adding anything to the client.

```
ModelClient            packages/dsqlbase/src/client/model/client.ts
  → RequestNormalizer  packages/dsqlbase/src/client/model/normalizer.ts   where/select/orderBy/join → SQL nodes
  → OperationsFactory  packages/core/src/runtime/operation.ts             column resolution, SelectParams, result resolvers
  → QueryBuilder       packages/core/src/runtime/query.ts                 SQL text
  → ExecutableQuery    packages/core/src/runtime/executor.ts             (CompositeQuery: several, combined)
  → Session.execute    consumer-supplied
```

- `ExecutionContext` (`packages/core/src/runtime/context.ts`) is `{ session, dialect, schema: SchemaRegistry, operations, identity?, tenancy, pagination? }`. There are still **no hooks, middleware, or interceptors** anywhere in the chain — identity is carried by the context, not by a hook, which is why it is fixed when a client is built rather than resolved per call.
- The "derived client" pattern is `attachModels(client, ctx)` in `packages/dsqlbase/src/client/database/base.ts`: build a new `ExecutionContext` with a different session or identity, then attach one `ModelClient` per table with `defineProperty`. `packages/dsqlbase/src/client/create.ts`, `transaction/transaction-client.ts` and `DatabaseClient.$identityClaims` all go through it. Each attached model is also recorded in `BaseClient._models`, keyed by alias.
- **Every table is attached to every client.** Which tables a client may address is decided by its _type_ (`VisibleFor` in `packages/dsqlbase/src/client/database/index.ts`); the runtime refusal lives in the factory, because that is the only thing a nested join level passes through. See [0005](../decisions/0005-tenant-client-visibility.md).
- **Node resolution runs beside model attachment**, not inside it: `registerNodes(registry, schema)` in `packages/dsqlbase/src/client/nodes.ts` is called once by `createClient`, keyed off the `SchemaRegistry` in a `WeakMap` so every derived client sees the same nodes. `$findByGlobalId` / `$listByGlobalId` on `BaseClient` resolve an id to a node and then go through that table's `ModelClient`, so a node lookup passes every seam a `findOne` does — the tenant predicate above all. See [0007](../decisions/0007-global-ids.md).
- Models are keyed by the schema **alias** — the key the table is exported under, which `Table.alias` carries (`packages/core/src/runtime/table.ts`), defaulting to the table name when a `Table` is built directly. `SchemaRegistry` (`packages/core/src/runtime/registry.ts`) maps both alias and DB table name to the same runtime `Table`, so `getTables()` yields an aliased table **twice**; `getTableEntries()` yields it once, keyed by alias, and is what anything iterating tables should use. `getAlias(nameOrAlias)` is the reverse lookup. There is still no models map on the context.

## Primary keys at runtime

- `Table.primaryKey: AnyColumn[]` (`packages/core/src/runtime/table.ts`) is the key in key order, empty when the table declares none; `Table.isCompositeKey` is `primaryKey.length > 1`. Anything that needs "the key of this table" — node lookup, keyset cursor tiebreakers — reads it from there.
- It is built from whichever source declares the key: the column-level `.primaryKey()` flag, or a `PrimaryKeyConstraintDefinition` in `TableDefinition._constraints` (`packages/core/src/definition/table.ts`), whose column refs carry DB names and resolve through `Table.getColumn`.
- **A table has at most one primary key.** Two flagged columns, a flagged column alongside a table-level constraint, or two table-level constraints all throw when the `Table` is built. The migration path never touches `Table`, so the `MULTIPLE_PRIMARY_KEYS` validation rule (`packages/migration/src/validation/rules/table.ts`) catches the same thing there. Both are needed because `packages/migration/src/ddl/printer.ts` prints each source independently — inline `PRIMARY KEY` per flagged column, a `PRIMARY KEY (...)` clause per constraint — so more than one produced DDL Postgres rejects. A composite key is one constraint over several columns: `table.primaryKey((c) => [...])`.
- `OperationsFactory` refuses updates to PK columns.

## Relations and joins

- `FieldRelation = { target, type: has_one | has_many | belongs_to, from[], to[] }` (`packages/core/src/definition/relations.ts`). Relations are runtime-only; the migration module ignores them (no FK emission).
- A join is `LEFT JOIN LATERAL (SELECT row_to_json(...) | json_agg(...) FROM (<inner select>) ...)` in `QueryBuilder`. The inner query is a full `buildSelectQuery`, so nested where/select/join/orderBy/limit already work recursively.
- `JoinParams.from` / `to` are column arrays and the correlation is built by `QueryBuilder` over every pair. `SchemaRegistry._buildRelations` validates each relation when the client is built: non-empty, equal-length sides; every column declared on the side it is listed under (checked by identity, so a same-named column from another table is rejected); both columns of a pair of the same `dataType`.
- A relation may not share a name with a column of the same table; `SchemaRegistry` throws when the client is built. Columns and relations are one field namespace because `select`, `join` and result keys address them alike.
- Joins are only allowed on declared relations. Every select level renders under its own `"__t<n>"` alias, so levels whose correlation names would otherwise collide — a join to the same table as an ancestor, or two tables sharing a name across schemas — stay distinct. Sibling joins to one table at a single level were never a problem; each lateral has its own scope. See [Select-tree aliasing](./select-tree-aliasing.md).
- Selection accepts only real columns. The `FieldSelection` type allows `SQLIdentifier` and nested arrays, and the result resolver already walks nested resolver trees, so virtual or nested fields are close in the resolver but absent in the normalizer and the types.
- Every level of a join resolves its own `$$meta`, so a nested row reports the table it came from rather than its parent's. See [Result resolution](#result-resolution-and-meta).
- A relation may target a `union()` — see [Union joins](#union-joins).

## Union joins

A relation to a union (`packages/core/src/definition/union.ts`) is a lateral join over a
`UNION ALL`, one branch per member that runs. The registry resolves each member's `to` columns
when the client is built (`SchemaRegistry.getUnionRelationColumns`), whichever form `to` was
written in, and `getRelationTarget` returns the runtime `Union` (`packages/core/src/runtime/union.ts`).

- **Normalizer.** `_getUnionArgs` (`packages/dsqlbase/src/client/model/normalizer.ts`) produces
  `UnionSelectOperationArgs`, with one `SelectOperationArgs` per member that runs. It maps the
  shared `select` / `where` onto each member's columns, merges `on.<alias>`, drops members set
  to `false`, and refuses non-shared fields and `distinct`. `$$key` conditions in the shared
  `where` are folded per member by `_foldKeyWhere`. The alias is a constant inside a branch, so
  each condition is decided before any SQL exists: a member whose `where` folds to `false`
  produces no branch, and a decided condition leaves no trace in SQL. `orderBy` stays structured
  (`UnionOrderKey[]`), because each member resolves the field to its own column.
- **Operations factory.** `_resolveUnionParams` builds every branch through
  `_resolveSelectParams(member, …)`, so each branch passes [the `WHERE` seam](#the-where-seam),
  tenant predicate included, and gets nested joins exactly as a table level would. A branch
  cannot skip them. Each branch projects:
  - `'<alias>' AS "$$key"` (`sql.literal`);
  - when ordered, every order key as `__o<n>`;
  - when ordered and every member's primary key has the same arity and types, the key as
    `__pk<n>`.
- **Limit pushdown.** With a `limit`, each branch is also ordered by the same keys and limited
  to `limit + offset`. This is valid because no row a branch drops could reach the combined page.
- **Query builder.** `_buildUnion` wraps each branch as
  `SELECT row_to_json(<branch>.*) AS "data", <carried columns>`, since members share no column
  list. It joins the branches with `UNION ALL` and orders the result by the carried names:
  `"__o<n>"`, then `"$$key"`, then `"__pk<n>"`. Each branch's correlation is added inside that
  branch, and the lateral aggregates `"data"` with `json_agg(… ORDER BY …)` for has-many, or
  takes the one row for has-one.
- **All members pruned.** No join is emitted. The resolver answers `[]` or `null`.
- **Belongs-to a union.** Joining one is refused until its discriminator is applied per branch.


## The `WHERE` seam

`OperationsFactory._resolveWhere(table, where?)` (`packages/core/src/runtime/operation.ts`) is
the single place a `WHERE` is assembled, and it is called **unconditionally** — for every select
(the root and every nested join level, since `_resolveJoinEntries` calls back into
`_resolveSelectParams`), every update and every delete, whether or not the caller passed a
filter. That is the point: a predicate injected here (a tenant boundary, a soft-delete rule)
must apply to a `findMany()` with no arguments as much as to a filtered one, and a seam that
only ran when the caller happened to filter would not be a rule at all.

`SelectOperationArgs.where` / `UpdateOperationArgs.where` / `DeleteOperationArgs.where` accept
`SQLNode | SQLNode[]`. The array is combined, not sampled:

| Conditions              | Result                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| none, or an empty array | `undefined` — no `WHERE` is rendered                                             |
| one                     | that node, untouched — no parentheses are added                                  |
| several                 | `sql.and` over each node **wrapped**, so an `OR` among them keeps its precedence |

The normalizer folds a user `where` object into one node before it reaches here
(`packages/dsqlbase/src/client/model/normalizer.ts`) — or into none at all, when the object
selects nothing in particular: `{}` and an empty `and` / `or` group mean "no filter", and the
operations that require a `where` (`findOne`, `update`, `delete`) refuse one that folds to
nothing. The array form is for callers that drive `OperationsFactory` directly, for whatever the
seam itself adds, and for `paginate`, which passes `[callerWhere, keyset]`.

### Order

Within one level, the tenant predicate leads, then the caller's `where`, then a keyset
predicate when `paginate` passed a cursor:

```sql
WHERE ("tasks"."workspace_id" = $1) AND ("tasks"."status" = $2) AND ("tasks"."created_at" < $3 OR …)
```

A joined level adds its correlation on the parent row, and that comes **first**: `QueryBuilder`,
which owns aliasing, renders `correlation AND (level conditions)`, wrapping whatever the seam
assembled for that level as one group. Order is cosmetic to the planner and deliberate for a
reader: the boundary is the first thing an `EXPLAIN` shows of the rows a level may hold.

### The tenant predicate

`_tenantPredicate(table)` is what the seam injects today. A table with no `tenantKeys` is global
and yields nothing. Otherwise `ExecutionContext.identity` decides:

| Identity | `tenancy.enforce` | Result                                                                              |
| -------- | ----------------- | ----------------------------------------------------------------------------------- |
| present  | either            | one equality per claim, AND-ed; a missing claim throws `TenancyError(table, claim)` |
| absent   | `true` (default)  | `TenancyError(table)` — the operation is not built                                  |
| absent   | `false`           | `undefined` — the query runs unscoped                                               |

Values go through `Column.param`, so a claim is encoded by its column's codec like any other
comparison ([codec boundary](./codec-boundary.md)). Throwing happens at **build** time — when
`findMany()` is called, before `execute` — so a missing identity never reaches the database.

This is also the only guard on a tenant table reached through a join. A nested level is named by
a relation rather than by the client, so no type can see it; the factory can, because every
level passes through `_resolveSelectParams`.

### Insert fill

`_resolveInsertEntries` fills each `tenantKeys` column from the identity, ahead of the generic
`getInsertValue` fallback, so `onCreate` and `DEFAULT` never apply to one. It throws in **both**
modes when there are no claims: the column is `notNull` and nothing else can fill it, so the
alternative is a row in no tenant. A caller-supplied value is already refused by the read-only
rule below — the claim wins.

## Result resolution and `$$meta`

`_createResultResolver` (`packages/core/src/runtime/operation.ts`) turns driver rows into
result records by walking a list of `[fieldName, howToResolve]` entries, one list per level.
There are three kinds of entry:

| Entry                    | Resolver           | Produces                                               |
| ------------------------ | ------------------ | ------------------------------------------------------ |
| `FieldResolver` (column) | an `AnyColumn`     | `column.resolve(row[column.name])` — the decoded value |
| `FieldResolver` (nested) | `ResolverEntry[]`  | a recursive resolve of the join's rows                 |
| `MetaResolver`           | `(row) => unknown` | a value computed from the driver row itself            |
| `FieldResolver` (union)  | `UnionResolver`    | each row resolved by the member its `$$key` names      |

The `row` a `MetaResolver` receives is the **raw driver row**, before any codec has decoded it
— the same row the column branch reads from. A resolver that needs the database's own text
representation of a value rather than the decoded one therefore has it.

`$$meta` is the only `MetaResolver` today. `_resolveFields` pushes it first for every level it
builds — the top level of a select, each join level, and each `return` selection — so every
result record leads with it:

```ts
resolvers.push([META_FIELD, () => table.meta]);
```

`Table.meta` (`packages/core/src/runtime/table.ts`) is frozen and built once, so every row of a
level shares one object by reference. It is `{ key, table, schema?, ...declared }`, where `key`
is the schema alias, `table` the database name, and `declared` whatever `table().meta()` set.
A `table().meta()` key that collides with a built-in throws when the `Table` is built.

`$$meta` and `$$key` are reserved field names (`RESERVED_FIELD_NAMES` in
`packages/core/src/definition/base.ts`): a column of that name throws at definition time, a
relation of that name when the registry is built. `$$key` names the member on every row of a
union result (see below).

An absent `belongsTo` stays `null` and an empty `hasMany` stays `[]` — no row, no meta.

A `UnionResolver` holds one resolver list per member that ran. For each row it reads `$$key`,
runs that member's list, `$$meta` included, and puts `$$key` on the record ahead of it. A row
naming a member that did not run throws, because this builder cannot produce one. Dispatch
decides _which_ resolvers run, so it happens before any field is read, not in a post-processing
step ([0004](../decisions/0004-record-meta.md)).

## Pagination and count

Keyset pagination is split the way global ids are: core provides general-purpose pieces and has
no opinion about cursors; the client owns the cursor format and the page shape.

**Core** (`packages/core`):

- `sql.keyset(keys, values, bound)` (`sql/tag.ts`) — the predicate selecting rows strictly past
  a cursor row. It is expanded key by key, `k0 > $a OR (k0 = $a AND (k1 > $b OR …))`, so mixed
  directions need no special case and nothing relies on row-value comparison. `bound: "before"`
  flips every comparison. Values are bound as bare parameters, never through a codec: they are
  already the database's own text. A nullable key adds `IS NULL` / `IS NOT NULL` branches, for
  nulls sorted last ascending and first descending — a `null` cursor value is valid only there.
- `SelectOperationArgs.keys` — columns projected a second time at the **root** level as
  `col::text AS "__k<n>"`, aliased like every other reference in the level. No resolver reads
  them, so they reach the raw driver row and never a result record. A join level asking for
  them is refused.
- `createCountOperation(table, { where })` — `SELECT count(*) AS "count"`, its `WHERE` built by
  the same seam, resolved with `Number(...)` (drivers return `bigint` as text or `bigint`).
- `Executable<T>` and `CompositeQuery` (`runtime/executor.ts`) — anything that runs when awaited
  and re-binds with `clone(session)`. `$transaction([...])` takes `Executable[]`, so a result
  built from several statements batches like one. A `CompositeQuery` runs its parts with
  `Promise.all` and combines them; cloned onto a transaction session, they share it.
- `ExecutionContext.pagination` carries `{ defaultLimit?, maxLimit? }` from `ClientOptions`;
  core reads neither.

**Client** (`packages/dsqlbase`):

- `RequestNormalizer.normalizePaginate` resolves the total order — the caller's `orderBy`, then
  every primary-key column not already named, in the direction of the last key, each marked
  nullable unless `notNull` or part of the primary key — refuses what cannot be paged (no
  primary key, `after` with `before`, a bad or oversized `limit`, a `null` cursor value for a
  key that cannot hold one), decodes the cursor, and returns the select with
  `where: [callerWhere, keyset]`, the order (flipped for `before`; a nullable key renders
  `ASC NULLS LAST` / `DESC NULLS FIRST`), `keys`, and `limit + 1`. It also returns
  `callerWhere` alone — the very node the page filters by — for the count.
- `ModelClient.paginate` builds the select and wraps its `resolve`: `shapePage`
  (`client/pagination/page.ts`) drops the extra row into `hasNextPage` / `hasPreviousPage`,
  resolves the rest, stamps each record's cursor from its `__k<n>` columns, reverses a `before`
  page, and fills `startCursor` / `endCursor`. With `count: true` it returns a `CompositeQuery`
  of the page and a count.
- The cursor (`client/pagination/cursor.ts`) is `c1.` + base64url of
  `[signature, ...values]`, where the signature is 8 hex characters of SHA-256 over the table
  alias and the ordered `field:direction` keys. `InvalidCursorError` is thrown before any SQL.

The cursor is stamped by wrapping `resolve` rather than as a `MetaResolver`: a `MetaResolver`
receives the raw row, but core would then need the cursor codec and the order's signature,
which are client concerns. `$$meta` is copied, never written to, since `Table.meta` is shared.

## Query args surface

Defined in `packages/dsqlbase/src/client/model/base.ts`: `select` (columns only), `where` (`eq/neq/gt/gte/lt/lte/in/between/exists/beginsWith/endsWith/contains` plus `and/or/not`, or value shorthand), `orderBy` (object of field → `asc|desc`, relies on key insertion order), `distinct`, `limit`, `offset`, `join` (relations only). `PaginateArgs` takes `select`, `where`, `orderBy` and `join` from it, plus `limit`, `after`, `before` and `count`; `CountArgs` takes `where`. No aggregate beyond `count`, and no row-value comparison in `sql.*`. **`findMany` applies no default limit** — the operations factory passes `limit` through unchanged; only `paginate` has one. (The JSDoc used to promise a default of 100; it was wrong and has been removed.)

## Read-only columns

`.readOnly()` (`packages/core/src/definition/column.ts`) marks a column system-managed: it is
readable, selectable, filterable and orderable like any other, and is removed from the two
mutation inputs. The runtime `Column.readOnly` carries the flag; `toJSON` does not, because
introspection cannot observe such a rule on a real database.

Enforcement is deliberately split:

- **The types** drop the field from `CreateValuesOf` and `UpdateValuesOf`
  (`packages/dsqlbase/src/client/model/base.ts`), so a `notNull` column with no default stops
  being a _required_ input — which is the whole reason the marker exists.
- **The normalizer** silently drops a read-only field from `data` / `set`
  (`_getMutationEntries`). It can only have arrived through an untyped spread, and dropping it
  keeps `create({ data: { ...input } })` working.
- **Core throws.** `_resolveInsertEntries` and `_resolveUpdateEntries` refuse a read-only column
  that carries a value, beside the existing primary-key refusal. Leniency belongs to the client;
  a direct `OperationsFactory` caller gets an error.

`tenantScope()` is the flag's other producer: a claim column is read-only by construction, since
its value comes from the client's identity.

## `$$meta.key` and `$$key`

`$$meta.key` is typed as the literal schema alias (`packages/dsqlbase/src/client/model/base.ts`),
resolved by a reverse lookup over the schema matched on the **database table name**. Matching on
the whole table type finds the root level and misses every nested one, because
`RelationJoinResultOf` rebuilds its target table from parts; `SchemaRegistry` already keys its
table map by name, so two tables in one schema cannot share one.

It still cannot discriminate a union: **TypeScript does not narrow on a nested property.** A
result that really is a union of tables carries a top-level `$$key` instead:
- the rows of a union join get it from the `UnionResolver`;
- `$findByGlobalId` / `$listByGlobalId` add it themselves.

`$$key` has been reserved since [0004](../decisions/0004-record-meta.md) for exactly this, and
the core constant is `KEY_FIELD`.

## Known gaps (fix, do not design around)

None open. When one is found, add it here with the code path it lives in and what it blocks; a
proposal that needs it names the fix as a prerequisite story rather than designing around it.
Public API may change; call out the changeset level.

## Related

- [Architecture](./architecture.md)
- [Codec boundary](./codec-boundary.md)
- [Select-tree aliasing](./select-tree-aliasing.md)
- [Querying (guide)](../guide/querying.md)
- [Tenancy (guide)](../guide/tenancy.md)
- [Global ids (guide)](../guide/global-ids.md)
- [0007 — Global ids](../decisions/0007-global-ids.md)
- [0005 — Tenant table visibility on the client](../decisions/0005-tenant-client-visibility.md)
