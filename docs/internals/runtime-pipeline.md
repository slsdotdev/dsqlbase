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
- **Gap:** `_validateWhereExpression` in `operation.ts` returns `where[0]` when given an array. It is a stub — and the natural seam for injecting predicates below the normalizer (tenancy, soft delete).
- Joins are only allowed on declared relations. Every select level renders under its own `"__t<n>"` alias, so levels whose correlation names would otherwise collide — a join to the same table as an ancestor, or two tables sharing a name across schemas — stay distinct. Sibling joins to one table at a single level were never a problem; each lateral has its own scope. See [Select-tree aliasing](./select-tree-aliasing.md).
- Selection accepts only real columns. The `FieldSelection` type allows `SQLIdentifier` and nested arrays, and the result resolver already walks nested resolver trees, so virtual or nested fields are close in the resolver but absent in the normalizer and the types.

## Query args surface

Defined in `packages/dsqlbase/src/client/model/base.ts`: `select` (columns only), `where` (`eq/neq/gt/gte/lt/lte/in/between/exists/beginsWith/endsWith/contains` plus `and/or/not`, or value shorthand), `orderBy` (object of field → `asc|desc`, relies on key insertion order), `distinct`, `limit`, `offset`, `join` (relations only). No count or aggregate, no keyset helpers, no row-value comparison in `sql.*`. **No default limit is applied** — the operations factory passes `limit` through unchanged. (The JSDoc used to promise a default of 100; it was wrong and has been removed.)

## Known gaps (fix, do not design around)

| Gap | Where | Affects |
|---|---|---|
| Codec not applied to where-clause values | `normalizer.ts` → `sql.eq/...` | any codec that changes wire format; see [Codec boundary](./codec-boundary.md) |
| `_validateWhereExpression` stub | `operation.ts` | predicate injection seam |
| No hooks / derived-client factory | `context.ts`, `transaction-client.ts` | tenancy/identity scoping |

When a proposal needs one of these, name the fix as a prerequisite story. Public API may change; call out the changeset level.

## Related

- [Architecture](./architecture.md)
- [Codec boundary](./codec-boundary.md)
- [Select-tree aliasing](./select-tree-aliasing.md)
- [Querying (guide)](../guide/querying.md)
