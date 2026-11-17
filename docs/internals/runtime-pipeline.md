# Runtime pipeline

_Audience: contributors and agents._

Every client feature threads through one chain. Know it before adding anything to the client.

```
ModelClient            packages/dsqlbase/src/client/clients/model.ts   (UnionClient: clients/union.ts)
  → RequestNormalizer  packages/dsqlbase/src/client/normalizers/request.ts   select/orderBy/join/mutations → operation args
      WhereBuilder     packages/dsqlbase/src/client/normalizers/where.ts     where → SQL node (held by the normalizer)
      PaginationHandler packages/dsqlbase/src/client/normalizers/pagination.ts  total order, cursor, keyset, page shape
  → OperationsFactory  packages/core/src/runtime/operation.ts             column resolution, SelectParams, result resolvers
  → QueryBuilder       packages/core/src/runtime/query.ts                 SQL text
  → ExecutableQuery    packages/core/src/runtime/executor.ts             (CompositeQuery: several, combined)
  → Session.execute    consumer-supplied
```

- `ExecutionContext` (`packages/core/src/runtime/context.ts`) is `{ session, dialect, schema: SchemaRegistry, operations, settings?, policies: { bypass } }`; the client's `ClientContext` (`packages/dsqlbase/src/client/normalizers/context.ts`) extends it with the `normalizer`, `pagination` (`PaginationHandler`) and `where` (`WhereBuilder`) the clients use. Core reads none of those three. There are still **no hooks, middleware, or interceptors** anywhere in the chain — per-request settings are carried by the context, not by a hook, which is why they are fixed when a client is built rather than resolved per call.
- The "derived client" pattern is `withModels(client)` in `packages/dsqlbase/src/client/clients/base.ts`: `BaseClient` keeps one `ModelClient` (or `UnionClient`) per alias in `_models`, and `withModels` returns a `Proxy` that serves them as properties. `createClient` (`packages/dsqlbase/src/client/create.ts`), `DsqlClient.$withClaims` (`clients/dsql.ts`) and the transaction runner (`clients/transaction.ts`) each build a fresh `ClientContext` with a different session or settings and wrap a new client in it. A client with settings is an ordinary `DsqlClient`: `$withClaims` only lays its values over the context's (a second call merges, `null` unsets), and changes nothing else the client can do.
- **Every table is attached to every client**, in the types and at runtime. What a client may read or write is decided by [row policies](#row-policies) in the factory, because that is the only thing a nested join level passes through. See [0024](../decisions/0024-row-policies.md).
- **Node resolution is a lookup, not a registry**: `$findByGlobalId(id)` on `BaseClient` calls `RequestNormalizer.resolveGlobalId` (`packages/dsqlbase/src/client/normalizers/request.ts`), which decodes the id, finds the table by alias in the `SchemaRegistry`, and builds the same request `get({ key })` does (`createGetRequest`) from the id's fields, adding a `__type` resolver. The request then goes through `createSelectOperation`, so a node lookup passes every seam a `findOne` does — row policies above all. There is no per-client node table and no list form. See [0007](../decisions/0007-global-ids.md).
- Models are keyed by the schema **alias** — the key the table is exported under, which `Table.alias` carries (`packages/core/src/runtime/table.ts`), defaulting to the table name when a `Table` is built directly. `SchemaRegistry` (`packages/core/src/runtime/registry.ts`) maps both alias and DB table name to the same runtime `Table`, so `getTables()` yields an aliased table **twice**; `getTableEntries()` yields it once, keyed by alias, and is what anything iterating tables should use. `getAlias(nameOrAlias)` is the reverse lookup. There is still no models map on the context.

## Primary keys at runtime

- `Table.primaryKey: AnyColumn[]` (`packages/core/src/runtime/table.ts`) is the key in key order, empty when the table declares none; `Table.isCompositeKey` is `primaryKey.length > 1`. Anything that needs "the key of this table" — node lookup, keyset cursor tiebreakers — reads it from there.
- It is built from whichever source declares the key: the column-level `.primaryKey()` flag, or a `PrimaryKeyConstraintDefinition` in `TableDefinition._constraints` (`packages/core/src/definition/table.ts`), whose column refs carry DB names and resolve through `Table.getColumn`.
- **A table has at most one primary key.** Two flagged columns, a flagged column alongside a table-level constraint, or two table-level constraints all throw when the `Table` is built. The migration path never touches `Table`, so the `MULTIPLE_PRIMARY_KEYS` validation rule (`packages/migration/src/validation/rules/table.ts`) catches the same thing there. Both are needed because `packages/migration/src/ddl/printer.ts` prints each source independently — inline `PRIMARY KEY` per flagged column, a `PRIMARY KEY (...)` clause per constraint — so more than one produced DDL Postgres rejects. A composite key is one constraint over several columns: `table.primaryKey((c) => [...])`.
- `OperationsFactory` refuses updates to PK columns.
- `Table.uniqueKeys` is every field set that names at most one row — the primary key, then each
  unique column, unique constraint and non-partial unique index over plain columns — each
  sorted, without repeats. The one-row lookups and writes below (`get`, `update`, `delete`,
  `$findByGlobalId`) read it through `RequestNormalizer._assertUniqueKeys`.

## One-row and many-row writes

`update` / `delete` take `key: {...}` (`UpdateUniqueArgs` / `DeleteUniqueArgs`,
`packages/dsqlbase/src/client/normalizers/base.ts`) and build with mode `"one"`; `updateMany` /
`deleteMany` take `where` and build with mode `"many"` (`ModelClient`,
`packages/dsqlbase/src/client/clients/model.ts`). SQL has no row limit on `UPDATE` / `DELETE`, so
"one" is a rule on the `key`, enforced before SQL exists: `RequestNormalizer._assertUniqueKeys`
(`normalizers/request.ts`) requires that `key` names every field of one of `Table.uniqueKeys`
(`get` is checked the same way), then `createUpdateUniqueRequest` / `createDeleteUniqueRequest`
reuse the `where` path with the key as the filter. The types require the key shape too. Core is
unchanged: it already resolved both modes. The rule lives in the client, so a direct
`OperationsFactory` caller is not held to it. See [0023](../decisions/0023-update-many.md).

## Relations and joins

- `FieldRelation = { target, type: has_one | has_many | belongs_to, from[], to[] }` (`packages/core/src/definition/relations.ts`). Relations are runtime-only; the migration module ignores them (no FK emission).
- A join is `LEFT JOIN LATERAL (SELECT row_to_json(...) | json_agg(...) FROM (<inner select>) ...)` in `QueryBuilder`. The inner query is a full `buildSelectQuery`, so nested where/select/join/orderBy/limit already work recursively.
- **Building a schema is three steps** that know nothing of each other. `validateSchema` (`packages/core/src/validation/validate.ts`) checks the definition and keeps nothing: per relation, non-empty, equal-length sides; every column declared on the side it is listed under (checked by identity, so a same-named column from another table is rejected) and not deprecated; both columns of a pair of the same `dataType`; field-name collisions; discriminator rules; union aliases. `buildSchema` (`packages/core/src/runtime/build.ts`) then builds tables, unions and one **`RuntimeRelation`** per table and field (`relation.ts`): runtime columns on both sides, the runtime target, per-member columns and the discriminator for a union target — and links every reference from those relations. `SchemaRegistry` only holds the result and looks things up.
- A relation is read through `SchemaRegistry.getRelation(table, field)` / `getRelations(table)`; nothing downstream resolves a relation definition again. A runtime `Table` holds no relations; its `TRelations` type parameter only carries their types for the client.
- `JoinParams.from` / `to` are column arrays and the correlation is built by `QueryBuilder` over every pair.
- A relation may not share a name with a column of the same table; `SchemaRegistry` throws when the client is built. Columns and relations are one field namespace because `select`, `join` and result keys address them alike.
- Joins are only allowed on declared relations. Every select level renders under its own `"__t<n>"` alias, so levels whose correlation names would otherwise collide — a join to the same table as an ancestor, or two tables sharing a name across schemas — stay distinct. Sibling joins to one table at a single level were never a problem; each lateral has its own scope. See [Select-tree aliasing](./select-tree-aliasing.md).
- A read's `select` takes columns and relations. `RequestNormalizer._parseQuerySelection` splits it before anything else: a relation named there (`true` or a field map) is merged into `join` as `true` or `{ select: map }`, ahead of the caller's own `join` entries, so everything downstream — `_getJoinEntries`, union args, core — sees one join form. The same relation truthy in both is refused. `on.<alias>.select` is split the same way. A write's `return` takes columns only.
- Which columns a level projects is carried by `SelectOperationArgs.select`: omitted means every column, `[]` means none. The normalizer sends `undefined` when the caller named nothing as `true`, and `[]` only when it named relations and no column — so `select: {}` still reads every column, and a relation-only select reads only its joins. `_resolveFields` is where the difference is made.
- Selection accepts no computed values. The `FieldSelection` type allows `SQLIdentifier` and nested arrays, and the result resolver already walks nested resolver trees, so virtual or nested fields are close in the resolver but absent in the normalizer and the types.
- Every level of a join resolves its own `__meta`, so a nested row reports the table it came from rather than its parent's. See [Result resolution](#result-resolution-and-meta).
- A relation may target a `union()` — see [Union joins](#union-joins).

## Column references

A runtime `Column` records what it points at, as `Column.references`
(`packages/core/src/runtime/column.ts`, types in `reference.ts`). `buildSchema`'s `linkReferences`
sets them from the runtime relations, for every column type, and freezes them once built; each
reference's `via` is the `RuntimeRelation` that set it.
Built columns belong to one registry, so a reference never leaks into another client.

- **On the foreign key, as in SQL.** A belongs-to sets one on each `from` column, pointing at the
  paired `to` column. A has-many / has-one sets one on each `to` column, pointing back at `from`
  — so a relation declared on `authors` writes onto `articles.authorId`. Both sides of one
  relation declared give the same reference, recorded once.
- **Two kinds.** `table` points at one column. `union` is set by a belongs-to a union, and by a
  has-many / has-one whose source is a union: `members` maps each member alias to the column the
  key points at there, and `discriminator` names the member per row. A has-many / has-one to a
  union sets a `table` reference on every member's column.
- **Computed discriminator.** Where a relation declares no discriminator column — a belongs-to a
  union without one, or the foreign key of a relation declared on a union — it is a
  `ComputedDiscriminator` (`reference.ts`): `CASE WHEN EXISTS (SELECT 1 FROM <member> AS "__d<i>"
  WHERE <key pairs>) THEN '<alias>' … END`, in member order. It is an `SQLNode`, so it compares
  like a column (a join's `correlate`, a filter's `discriminator = $1`), and is projected as
  `<expr> AS "<key>$key"`, the name a column's `read` hook reads it by. The member is aliased inside its
  probe only, so the key columns keep their outer alias. The registry makes one per union and key
  columns, so a has-many from a union and a belongs-to back to it share one reference and one
  probe. The probe skips the members' row policies: it only names which member holds a key the
  row already carries. It still reveals which member holds a key.
- **`dependsOn`** is the discriminator of each union reference — a column, or a computed one.
  `_resolveFields` projects it with the column whenever the column is selected, ungated by type.
- **`resolveReferences(row?)`** follows table references to where each chain ends (a column with
  no references ends at itself) and reports a ring instead of looping. A union reference is an
  end of its own; given the row, it resolves to the member its discriminator names. It never
  throws: a plain key may legitimately point at two tables, so whether two ends or a ring is a
  conflict is the reader's decision — `guidHooks` (`packages/dsqlbase/src/schema/utils/guid-hooks.ts`) and `validateSchema` refuse both for a `guid()` column.
- Joins do not read references: `_resolveJoins` stays relation-driven, since a has-many join
  starts on the source table while its reference sits on the target.

## Union joins

A relation to a union (`packages/core/src/definition/union.ts`) is a lateral join over a
`UNION ALL`, one branch per member that runs. The registry resolves each member's `to` columns
when the client is built — the relation's `members` — whichever form `to` was written in, and
its `target` is the runtime `Union` (`packages/core/src/runtime/union.ts`).

- **Normalizer.** `_getUnionSelectArgs` (`packages/dsqlbase/src/client/normalizers/request.ts`) produces
  `UnionSelectOperationArgs`, with one `SelectOperationArgs` per member that runs. It maps the
  shared `select` / `where` onto each member's columns, merges `on.<alias>`, drops members set
  to `false`, and refuses undeclared fields and `distinct`. a shared `where` is first passed
  through `WhereBuilder.unwrap` (`normalizers/where.ts`), which runs each shared column's
  `hooks.filter` over its values — so a global id on a shared guid field is unwrapped to the key
  its member stores, and an id naming another node can never match it — and then merged into
  each member's own `where`. `orderBy` stays structured
  (`UnionOrderKey[]`), because each member resolves the field to its own column.
- **Operations factory.** `_resolveUnionParams` builds every branch through
  `_resolveSelectParams(member, …)`, so each branch passes [the `WHERE` seam](#the-where-seam),
  the member's row policies included, and gets nested joins exactly as a table level would. A branch
  cannot skip them. Each branch projects:
  - `'<alias>' AS "__type"` (`sql.literal`);
  - when ordered, every order key as `__o<n>`;
  - when ordered and every member's primary key has the same arity and types, the key as
    `__pk<n>`.
- **Limit pushdown.** With a `limit`, each branch is also ordered by the same keys and limited
  to `limit + offset`. This is valid because no row a branch drops could reach the combined page.
- **Query builder.** `_buildUnion` wraps each branch as
  `SELECT row_to_json(<branch>.*) AS "data", <carried columns>`, since members share no column
  list. It joins the branches with `UNION ALL` and orders the result by the carried names:
  `"__o<n>"`, then `"__type"`, then `"__pk<n>"`. Each branch's correlation is added inside that
  branch, and the lateral aggregates `"data"` with `json_agg(… ORDER BY …)` for has-many, or
  takes the one row for has-one.
- **All members pruned.** No join is emitted. The resolver answers `[]` or `null`.
- **Belongs-to a union.** The relation's `discriminator` is its discriminator column, or the
  computed one when it declares none. Each branch then carries
  `correlate: [discriminator = '<alias>']`, which the builder renders in the parent's scope next
  to the correlation, so only the named member's branch can match — with a computed one, the
  first member holding the key.
- **A union as the source.** `relations(union, …)` gives every member a `RuntimeRelation` of its
  own (`collectRelations` in `validate.ts`, built by `buildSchema`), with `from` resolved to its
  own column and `declaredOn` the union. A join from a union branch, or from a
  member read alone, is then an ordinary table join. The normalizer's `_getUnionSelectArgs` takes the
  union's relations in the shared `join` / `select` and merges them into every member's join.
  A has-many / has-one declared on a union sets no per-member reference; `linkReferences` sets
  one `union` reference on the foreign key instead, after every other relation, so a
  belongs-to back over the same key shares its discriminator.


## The `WHERE` seam

`OperationsFactory._resolveWhere(table, commands, where?)` (`packages/core/src/runtime/operation.ts`) is
the single place a `WHERE` is assembled, and it is called **unconditionally** — for every select
(the root and every nested join level, since `_resolveJoinEntries` calls back into
`_resolveSelectParams`), every update and every delete, whether or not the caller passed a
filter. That is the point: a predicate injected here (a row policy, a soft-delete rule)
must apply to a `findMany()` with no arguments as much as to a filtered one, and a seam that
only ran when the caller happened to filter would not be a rule at all.

`SelectOperationArgs.where` / `UpdateOperationArgs.where` / `DeleteOperationArgs.where` accept
`SQLNode | SQLNode[]`. The array is combined, not sampled:

| Conditions              | Result                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| none, or an empty array | `undefined` — no `WHERE` is rendered                                             |
| one                     | that node, untouched — no parentheses are added                                  |
| several                 | `sql.and` over each node **wrapped**, so an `OR` among them keeps its precedence |

The normalizer's `WhereBuilder` folds a user `where` object into one node before it reaches here
(`packages/dsqlbase/src/client/normalizers/where.ts`) — or into none at all, when the object
selects nothing in particular: `{}` and an empty `and` / `or` group mean "no filter". `findOne`
and `findMany` take that as "every row"; `get`, `update` and `delete` need a `key`, and
`updateMany` / `deleteMany` currently accept a `where` that folds to nothing (see
[Known gaps](#known-gaps-fix-do-not-design-around)). The array form is for callers that drive
`OperationsFactory` directly, for whatever the seam itself adds, and for `paginatedQuery`, which
passes `[callerWhere, keyset]`.

### Order

Within one level, the row-policy predicate leads, then the caller's `where`, then a keyset
predicate when `paginatedQuery` passed a cursor:

```sql
WHERE ("tasks"."workspace_id" = $1) AND ("tasks"."status" = $2) AND ("tasks"."created_at" < $3 OR …)
```

A joined level adds its correlation on the parent row, and that comes **first**: `QueryBuilder`,
which owns aliasing, renders `correlation AND (level conditions)`, wrapping whatever the seam
assembled for that level as one group. Order is cosmetic to the planner and deliberate for a
reader: the boundary is the first thing an `EXPLAIN` shows of the rows a level may hold.

### Row policies

`table.policy(name, config)` (`packages/core/src/definition/table.ts`) records a
`PolicyDeclaration`; names are checked there (an identifier, unique per table). The callback's
type, `PolicyResolver` (`packages/core/src/resolvers/policy.ts`), takes the runtime columns:
`Table`'s generics are the definition's, so `TableColumns` maps them with no extra type. The
runtime `Table` runs each callback once against its own columns and freezes the result as
`Table.policies` (`RuntimePolicy`, `packages/core/src/runtime/policy.ts`), refusing what
`CREATE POLICY` would — `using` on insert only, `check` on select / delete only — and a policy
missing the `using` or check a command it covers reads. `Table.policiesFor(command)` returns
them grouped into permissive and restrictive.

`_resolveWhere` takes the commands whose policies bound the rows: `["select"]` for every read
level (root, join, union branch, count, page, node lookup), `["update", "select"]` for an update,
`["delete", "select"]` for a delete. `_policyPredicate(table, commands)` builds, per command,
`(OR of permissive using)` — `false` when there is none, since a table with any policy denies by
default — and ANDs every restrictive policy of every command onto it, each policy once. A table
with no policies, or a context with `policies.bypass`, yields nothing.

**Writes** are checked in the statement itself. `_policyCheck(table, "insert" | "update")`
appends one `RETURNING` expression to every insert and update, whether or not the caller asked
for rows:

```sql
CAST(CASE WHEN NOT COALESCE((<restrictive check>), false) THEN 'dsqlbase.policy:<alias>:restrictive:<name>' || <sfx>
          …
          WHEN NOT COALESCE((<permissive check>) OR …, false) THEN 'dsqlbase.policy:<alias>:permissive:<names>' || <sfx>
          ELSE NULL END AS int) AS "__pc"
```

A failing row casts its marker to `int`, which fails the statement — atomically, nothing written,
inside a transaction too (verified on DSQL). `COALESCE(…, false)` makes a `NULL` check fail.
`<sfx>` is `coalesce(left(<first key column>::text, 0), '')`: always empty, never `NULL`, but
row-dependent, so a check over parameters alone is not folded at plan time into an error on an
update that matched nothing. No resolver reads `__pc`. `ExecutableQuery.execute`
(`packages/core/src/runtime/executor.ts`) decodes the marker from the driver error's message
into `PolicyViolationError` (`runtime/errors.ts`), with the driver error as `cause`, so a
consumer-written session gets it too; the transaction runner retries only `40001`, so it rolls
back and rethrows.

### Claims

A policy compares rows with per-request **claims** — who the user is, which workspace they act
in. `sql.claim(key)` (`packages/core/src/sql/tag.ts`) builds an `SQLClaim` node
(`packages/core/src/sql/nodes.ts`) that renders by looking `key` up in `SQLContext.claims` and
binding an `SQLParam`, `NULL` when unset. `ExecutionContext.settings` holds the values; every
`create*Operation` renders with `query.toQuery({ claims: ctx.settings })`, so they are bound when
the operation is built, and an operation re-bound to another session by `clone` keeps them.
`DsqlClient.$withClaims(values)` (`packages/dsqlbase/src/client/clients/dsql.ts`) is where a
client takes them: it merges over the parent's and returns a new client.

`$onCreate` may return an `SQLNode`, such as a claim: `Column.getInsertValue` passes any `SQLNode`
through, so it renders like `DEFAULT` does. Nothing checks a missing claim; the policy that reads
it, or a `notNull` column it fills, refuses it.

### Insert and update hooks

`_resolveInsertEntries` writes every column, so one the caller did not write takes its
`$onCreate` or `DEFAULT`. `_resolveUpdateEntries` likewise runs `$onUpdate` for every column the
update does not name, so a hook fires on every update, not only when its column is set.

## Result resolution and `__meta`

`_createResultResolver` (`packages/core/src/runtime/operation.ts`) turns driver rows into
result records by walking a list of `[fieldName, howToResolve]` entries, one list per level.
There are three kinds of entry:

| Entry                    | Resolver           | Produces                                               |
| ------------------------ | ------------------ | ------------------------------------------------------ |
| `FieldResolver` (column) | an `AnyColumn`     | `column.resolve(row[column.name], row)` — the decoded value, its hooks handed the row |
| `FieldResolver` (nested) | `ResolverEntry[]`  | a recursive resolve of the join's rows                 |
| `MetaResolver`           | `(row) => unknown` | a value computed from the driver row itself            |
| `FieldResolver` (union)  | `UnionResolver`    | each row resolved by the member its `__type` names      |

The `row` a `MetaResolver` receives is the **raw driver row**, before any codec has decoded it
— the same row the column branch reads from. A resolver that needs the database's own text
representation of a value rather than the decoded one therefore has it.

A column is always a `FieldResolver`: its value is decoded from its own field, and its `read`
hook, if it has one, gets the whole row of that level — root, joined or union branch — to read
siblings from (see [Codec boundary](./codec-boundary.md#column-hooks)). Which siblings the row
holds is core's decision: `_resolveFields` projects every selected column's `dependsOn` — the
discriminator of a union reference, see [Column references](#column-references) — with or
without hooks, so a plain-`uuid` belongs-to a union also selects its discriminator.

The one `MetaResolver` is `__meta`, which `_resolveFields` pushes first for every level it
builds — the top level of a select, each join level, and each `return` selection — so every
result record leads with it (`META_FIELD` in `packages/core/src/definition/base.ts`):

```ts
resolvers.push([META_FIELD, () => table.meta]);
```

`Table.meta` (`packages/core/src/runtime/table.ts`) is frozen and built once, so every row of a
level shares one object by reference. It is `{ key, table, schema?, ...declared }`, where `key`
is the schema alias, `table` the database name, and `declared` whatever `table().meta()` set.
A `table().meta()` key that collides with a built-in throws when the `Table` is built.

`__meta` and `__type` are reserved field names (`META_FIELD` / `KEY_FIELD`, `RESERVED_FIELD_NAMES` in
`packages/core/src/definition/base.ts`): a column of that name throws at definition time, a
relation of that name when the registry is built. `__type` names the member on every row of a
union result (see below).

An absent `belongsTo` stays `null` and an empty `hasMany` stays `[]` — no row, no meta.

A `UnionResolver` holds one resolver list per member that ran. For each row it reads `__type`,
runs that member's list, `__meta` included, and puts `__type` on the record ahead of it. A row
naming a member that did not run throws, because this builder cannot produce one. Dispatch
decides _which_ resolvers run, so it happens before any field is read, not in a post-processing
step ([0004](../decisions/0004-record-meta.md)).

## Pagination and count

Keyset pagination is split the way global ids are: core provides general-purpose pieces and has
no opinion about cursors; the client owns the cursor format and the page shape.

**Core** (`packages/core`):

- `SelectOperationArgs.keyset` — `{ values, bound }`, the cursor row's order keys as the
  database's own text. It enters the level's `WHERE` after the caller's, as a predicate selecting
  rows strictly past that row, expanded key by key (`k0 > $a OR (k0 = $a AND (k1 > $b OR …))`)
  so mixed directions need no special case and nothing relies on row-value comparison. The
  client builds the predicate (`WhereBuilder.buildKeyset`) and passes the values as bare
  parameters, never through a codec. A nullable key adds `IS NULL` / `IS NOT NULL` branches, for
  nulls sorted last ascending and first descending — a `null` cursor value is valid only there.
  `bound: "before"` flips every comparison.
- `SelectOperationArgs.keys` — a flag: project every key of the order a second time at the
  **root** level as `col::text AS "__k<n>"`, aliased like every other reference in the level. No
  resolver reads them, so they reach the raw driver row and never a result record. A join level
  asking for them is refused. A union read at the root projects them per branch instead
  (`UnionSelectOperationArgs.keys`) and carries them to the union level, which the root is.
- **Union pages.** `createUnionSelectOperation` / `createUnionCountOperation` run a union at the
  root. The total order is the caller's keys, then `__type` unless the caller named it, then each
  primary-key column by position (`$$pk<n>`), when `Union.tiebreakers` says the members' keys
  line up — otherwise paging throws. The appended keys run in `tiebreak`. The keyset enters each
  branch as a `where` element, where `__type` is the constant literal. A `before` bound reverses
  the union order and every branch's pushdown order, while the keyset is written against the
  order as given. The union count adds one `count(*)` per member, each built through the seam.
- `createCountOperation(table, { where })` — `SELECT count(*) AS "count"`, its `WHERE` built by
  the same seam, resolved with `Number(...)` (drivers return `bigint` as text or `bigint`).
- `Executable<T>` and `CompositeQuery` (`runtime/executor.ts`) — anything that runs when awaited
  and re-binds with `clone(session)`. `$transaction([...])` takes `Executable[]`. No client
  method builds a `CompositeQuery` now (a page is one statement); it stays exported for callers
  that combine statements.

**Client** (`packages/dsqlbase/src/client/normalizers/pagination.ts`):

- `PaginationHandler.paginateRequest` / `paginateUnionRequest` take the normalized select and
  resolve the total order — the caller's `orderBy`, then every primary-key column not already
  named, in the direction of the last key — refuse what cannot be paged (no primary key, `after`
  with `before`, a bad or oversized `limit`, a `null` cursor value for a key that cannot hold
  one, a union with no tiebreaker), decode the cursor, and set `limit + 1`, the order (flipped
  for `before`; a nullable key renders `ASC NULLS LAST` / `DESC NULLS FIRST`), `keys`, and the
  keyset from `WhereBuilder.buildKeyset`.
- The page resolver (`_createPageResolver`) drops the extra row into `hasMore`, resolves the
  rest, stamps each item's `__cursor` from its `__k<n>` columns, reverses a `before` page, and
  returns `{ items, hasMore, nextCursor }` — `nextCursor` is the last item's cursor when
  `hasMore`, else `null`. There is no total count and no page-info beyond `hasMore`.
- `ModelClient.paginatedQuery` (`clients/model.ts`) and `UnionClient.paginatedQuery`
  (`clients/union.ts`) run it. A union mirrors core's total order to sign the cursor (union
  alias, caller keys, `__type`, `$$pk<n>`).
- The cursor (`encodeCursor`, `CURSOR_PREFIX`, `InvalidCursorError`) is `c1.` + base64url of
  `[signature, ...values]`, where the signature is 8 hex characters of SHA-256 over the table
  alias and the ordered `field:direction` keys. `InvalidCursorError` is thrown before any SQL.
- Page size: `defaultLimit` and `maxLimit` come from `ClientOptions.pagination`, both defaulting
  to `DEFAULT_PAGE_SIZE` (100), so a `limit` above 100 throws unless `maxLimit` is raised. The
  options are not validated when the client is built; a bad value surfaces on the first page.

The cursor is stamped by wrapping `resolve` rather than as a `MetaResolver`: a `MetaResolver`
receives the raw row, but core would then need the cursor codec and the order's signature,
which are client concerns. `__meta` is copied, never written to, since `Table.meta` is shared.

## Query args surface

Defined in `packages/dsqlbase/src/client/normalizers/base.ts`: `select` (columns, and relations as field maps), `where` (per field, the operators of the column's runtime type plus `and/or/not`, or value shorthand where the type takes one — see below), `orderBy` (object of field → `asc|desc`, relies on key insertion order; orderable runtime types only), `distinct`, `limit`, `offset`, `join` (relations only). `PaginatedQueryArgs` takes `select`, `where`, `orderBy`, `join` and `limit` from it, plus `after` and `before` (no `distinct`, `offset` or `count`); `GetArgs` is `{ key, select?, join? }`, `UpdateUniqueArgs` / `DeleteUniqueArgs` replace `where` with `key`; `CountArgs` takes `where`. No aggregate beyond `count`, and no row-value comparison in `sql.*`. **`findMany` applies no default limit** — the operations factory passes `limit` through unchanged; only `paginatedQuery` has one. (The JSDoc used to promise a default of 100; it was wrong and has been removed.)

### Operators by runtime type

Every column carries a **runtime type** — `ColumnConfig.runtimeType`, set by each builder,
inherited from a domain, exposed as `Column.runtimeType` (`packages/core`). It is the kind of
value the column holds for querying, not its JavaScript form. Core attaches no meaning to it.

The client gives it one: `packages/dsqlbase/src/client/normalizers/rules.ts` holds a single table
(`RUNTIME_COLUMN_RULES`) of runtime type → operators, value shorthand, orderable, and whether
`distinct` can compare it. Both sides read that table:

- **Types** — `FilterOf<R, V>` / `WhereExpressionOf` and `OrderableFieldNamesOf` in
  `normalizers/base.ts`, are written from it (`OperatorsOf`,
  `ShorthandRuntimeType`, `OrderableRuntimeType`), for tables and for a union's shared fields.
- **Runtime** — `WhereBuilder.buildColumnCondition` checks every operator of a field's filter
  against the column's set and AND-s the ones present; a bare value is accepted only where the
  type takes one; the normalizer's `_getOrderByEntries` refuses unorderable
  columns, and `distinct` refuses a selected column it cannot compare. All of it throws before SQL is built, so a caller
  the types cannot see (a resolver passing arguments through) gets the same rules.

An operator name keeps one meaning per runtime type. `contains` is `LIKE` on `string` and
`jsonb` containment on the `jsonb` runtime types — `jsonb`, `array`, `object`
(`JSONB_RUNTIME_TYPES`; `sql.jsonbContains`, `col @> $1`); `ContainsValueOf` types it as a
substring or as a `JsonFragment` of the value, an array of item fragments on `array`, where the
`WhereBuilder` also refuses a lone item. A fragment goes through `Column.param`, so it is encoded but
not validated. `hasKey` (`sql.jsonbHasKey`, `col ? $1`) is on `object` only: on an array or a
scalar `?` also matches string elements, a different meaning. Its key is sent raw, never
through the codec, since it is not a value of the column. `json` and `jsonb`
are separate runtime types because only `jsonb` has equality and containment.

A plain object counts as operators only when it names one, since a value can itself be a plain
object (an `interval` read as a `Duration`). `where` inside a field's filter is reserved for a
nested filter into the value and throws until it is built.

## Read-only columns

`.readOnly()` (`packages/core/src/definition/column.ts`) marks a column system-managed: it is
readable, selectable, filterable and orderable like any other, and is removed from the two
mutation inputs. The runtime `Column.readOnly` carries the flag; `toJSON` does not, because
introspection cannot observe such a rule on a real database.

Enforcement is deliberately split:

- **The types** drop the field from `CreateValuesOf` and `UpdateValuesOf`
  (`packages/dsqlbase/src/client/normalizers/base.ts`), so a `notNull` column with no default stops
  being a _required_ input — which is the whole reason the marker exists.
- **The normalizer** silently drops a read-only field from `data` / `set`
  (`_getMutationEntries`). It can only have arrived through an untyped spread, and dropping it
  keeps `create({ data: { ...input } })` working. The same step (`_resolveMutationValues`) runs
  each column's `hooks.writeDeps` and fills its `dependsOn` columns — a guid's discriminator —
  refusing a caller-given value that conflicts with the computed one.
- **Core throws.** `_resolveInsertEntries` and `_resolveUpdateEntries` refuse a read-only column
  that carries a value, beside the existing primary-key refusal. Leniency belongs to the client;
  a direct `OperationsFactory` caller gets an error.

A read-only column filled by `$onCreate(() => setting)` is the pattern for a column a row policy
reads: always written from the client's settings, never from the caller.

## `__meta.key` and `__type`

`__meta.key` is typed as the literal schema alias (`packages/dsqlbase/src/client/normalizers/base.ts`),
resolved by a reverse lookup over the schema matched on the **database table name**. Matching on
the whole table type finds the root level and misses every nested one, because
`RelationJoinResultOf` rebuilds its target table from parts; `SchemaRegistry` already keys its
table map by name, so two tables in one schema cannot share one.

It still cannot discriminate a union: **TypeScript does not narrow on a nested property.** A
result that really is a union of tables carries a top-level `__type` instead:
- the rows of a union join get it from the `UnionResolver`;
- `$findByGlobalId` adds it itself.

`__type` has been reserved since [0004](../decisions/0004-record-meta.md) for exactly this, and
the core constant is `KEY_FIELD`.

## Known gaps (fix, do not design around)

When one is found, add it here with the code path it lives in and what it blocks; a proposal
that needs it names the fix as a prerequisite story rather than designing around it. Public API
may change; call out the changeset level. Open since the 0.2.0 release review (2026-10-03):

- **No OCC retry outside `$transaction`.** A single `create` / `update` / `delete` that hits
  `40001` throws (`packages/dsqlbase/src/client/utils/occ-retry.ts` is only used by the
  transaction runner). Also there: `maxRetries` counts attempts, not retries, jitter is 10%, and
  there is no statement timeout.
- **`updateMany` / `deleteMany` accept an empty `where`.** `RequestNormalizer.createUpdateRequest`
  / `createDeleteRequest` fold `{}` to no filter, so the call changes every row the policies
  allow; the types require the field, not that it constrain anything.
- **`createClient` does not validate `pagination`.** A non-positive `defaultLimit`, or one above
  `maxLimit`, throws on the first page instead of at construction.
- **Cursor and global-id input** has no length cap, and a value invalid for the column's type
  surfaces as the database's `22P02` rather than `InvalidCursorError` / `GlobalIdError`. An id
  for an unknown table or a key that is not unique throws a plain `Error`, not a `GlobalIdError`.
- **An explicit `null` on insert becomes `DEFAULT`** (`Column.getInsertValue`), so a column with
  a default can't be inserted `NULL`.
- **A read validator failing on one stored row fails the whole `findMany`.** A lenient read mode
  would let old rows through.
- **References across a policy boundary.** A client can insert a row whose foreign key points at
  a parent its policies hide; a check reads only the written row's own columns, and a subquery
  in a policy is not bounded by the other table's policies.

## Related

- [Architecture](./architecture.md)
- [Codec boundary](./codec-boundary.md)
- [Select-tree aliasing](./select-tree-aliasing.md)
- [Querying (guide)](../guide/querying.md)
- [Row policies (guide)](../guide/policies.md)
- [Global ids (guide)](../guide/global-ids.md)
- [0007 — Global ids](../decisions/0007-global-ids.md)
- [0024 — Row policies](../decisions/0024-row-policies.md)
