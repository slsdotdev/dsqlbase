# Runtime pipeline

_Audience: contributors and agents._

Every client feature threads through one chain. Know it before adding anything to the client.

```
ModelClient            packages/dsqlbase/src/client/model/client.ts
  → RequestNormalizer  packages/dsqlbase/src/client/model/normalizer.ts   where/select/orderBy/join → SQL nodes
  → OperationsFactory  packages/core/src/runtime/operation.ts             column resolution, SelectParams, result resolvers
  → QueryBuilder       packages/core/src/runtime/query.ts                 SQL text
  → ExecutableQuery    packages/core/src/runtime/executor.ts
  → Session.execute    consumer-supplied
```

- `ExecutionContext` (`packages/core/src/runtime/context.ts`) is `{ session, dialect, schema: SchemaRegistry, operations }`. There are **no hooks, middleware, or interceptors** anywhere in the chain.
- The "derived client" pattern is `attachModels(client, ctx)` in `packages/dsqlbase/src/client/database/base.ts`: build a new `ExecutionContext` with a different session, then attach one `ModelClient` per table with `defineProperty`. Both `packages/dsqlbase/src/client/create.ts` and `packages/dsqlbase/src/client/transaction/transaction-client.ts` go through it, and any scoped client (tenancy, identity) should too. Each attached model is also recorded in `BaseClient._models`, keyed by alias.
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

| Conditions | Result |
|---|---|
| none, or an empty array | `undefined` — no `WHERE` is rendered |
| one | that node, untouched — no parentheses are added |
| several | `sql.and` over each node **wrapped**, so an `OR` among them keeps its precedence |

The normalizer folds a user `where` object into one node before it reaches here
(`packages/dsqlbase/src/client/model/normalizer.ts`), so the array form is for callers that
drive `OperationsFactory` directly — and for whatever the seam itself adds.

## Result resolution and `$$meta`

`_createResultResolver` (`packages/core/src/runtime/operation.ts`) turns driver rows into
result records by walking a list of `[fieldName, howToResolve]` entries, one list per level.
There are three kinds of entry:

| Entry | Resolver | Produces |
|---|---|---|
| `FieldResolver` (column) | an `AnyColumn` | `column.resolve(row[column.name])` — the decoded value |
| `FieldResolver` (nested) | `ResolverEntry[]` | a recursive resolve of the join's rows |
| `MetaResolver` | `(row) => unknown` | a value computed from the driver row itself |

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
relation of that name when the registry is built. `$$key` is reserved ahead of its use, since
reserving a name costs nothing now and is a breaking change later.

An absent `belongsTo` stays `null` and an empty `hasMany` stays `[]` — no row, no meta.

## Query args surface

Defined in `packages/dsqlbase/src/client/model/base.ts`: `select` (columns only), `where` (`eq/neq/gt/gte/lt/lte/in/between/exists/beginsWith/endsWith/contains` plus `and/or/not`, or value shorthand), `orderBy` (object of field → `asc|desc`, relies on key insertion order), `distinct`, `limit`, `offset`, `join` (relations only). No count or aggregate, no keyset helpers, no row-value comparison in `sql.*`. **No default limit is applied** — the operations factory passes `limit` through unchanged. (The JSDoc used to promise a default of 100; it was wrong and has been removed.)

## Read-only columns

`.readOnly()` (`packages/core/src/definition/column.ts`) marks a column system-managed: it is
readable, selectable, filterable and orderable like any other, and is removed from the two
mutation inputs. The runtime `Column.readOnly` carries the flag; `toJSON` does not, because
introspection cannot observe such a rule on a real database.

Enforcement is deliberately split:

- **The types** drop the field from `CreateValuesOf` and `UpdateValuesOf`
  (`packages/dsqlbase/src/client/model/base.ts`), so a `notNull` column with no default stops
  being a *required* input — which is the whole reason the marker exists.
- **The normalizer** silently drops a read-only field from `data` / `set`
  (`_getMutationEntries`). It can only have arrived through an untyped spread, and dropping it
  keeps `create({ data: { ...input } })` working.
- **Core throws.** `_resolveInsertEntries` and `_resolveUpdateEntries` refuse a read-only column
  that carries a value, beside the existing primary-key refusal. Leniency belongs to the client;
  a direct `OperationsFactory` caller gets an error.

Nothing sets the flag for you yet — `tenantScope()` is its first producer.

## Known gaps (fix, do not design around)

| Gap | Where | Affects |
|---|---|---|
| No hooks / derived-client factory | `context.ts`, `transaction-client.ts` | tenancy/identity scoping |

When a proposal needs one of these, name the fix as a prerequisite story. Public API may change; call out the changeset level.

## Related

- [Architecture](./architecture.md)
- [Codec boundary](./codec-boundary.md)
- [Select-tree aliasing](./select-tree-aliasing.md)
- [Querying (guide)](../guide/querying.md)
