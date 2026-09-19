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
- The only "derived client" pattern is `packages/dsqlbase/src/client/transaction/transaction-client.ts`: build a new `ExecutionContext` with a different session, re-attach one `ModelClient` per table with `defineProperty`. Any scoped client (tenancy, identity) will copy this pattern until a shared factory exists.
- Models are attached to `DatabaseClient` keyed by the schema **alias** (the export name), in `packages/dsqlbase/src/client/create.ts`. `SchemaRegistry` (`packages/core/src/runtime/registry.ts`) maps both alias and DB table name to the runtime `Table`. There is no reverse map from table name to alias and no models map on the context.

## Primary keys at runtime

- `Column.primaryKey` exists for column-level `.primaryKey()`.
- Table-level composite keys live in `TableDefinition._constraints` (`packages/core/src/definition/table.ts`) and are **not** exposed on the runtime `Table` (`packages/core/src/runtime/table.ts` exposes columns and relations only). Anything that needs "the key of this table" — node lookup, keyset cursor tiebreakers — has to add that.
- `OperationsFactory` refuses updates to PK columns.

## Relations and joins

- `FieldRelation = { target, type: has_one | has_many | belongs_to, from[], to[] }` (`packages/core/src/definition/relations.ts`). Relations are runtime-only; the migration module ignores them (no FK emission).
- A join is `LEFT JOIN LATERAL (SELECT row_to_json(...) | json_agg(...) FROM (<inner select>) ...)` in `QueryBuilder`. The inner query is a full `buildSelectQuery`, so nested where/select/join/orderBy/limit already work recursively.
- **Gap:** only `from[0]` / `to[0]` are used; composite relations are silently truncated.
- **Gap:** `_validateWhereExpression` in `operation.ts` returns `where[0]` when given an array. It is a stub — and the natural seam for injecting predicates below the normalizer (tenancy, soft delete).
- Joins are only allowed on declared relations. **Gap:** inner queries use raw table names with no aliasing, so a self-join or the same table twice at one level would collide.
- Selection accepts only real columns. The `FieldSelection` type allows `SQLIdentifier` and nested arrays, and the result resolver already walks nested resolver trees, so virtual or nested fields are close in the resolver but absent in the normalizer and the types.

## Query args surface

Defined in `packages/dsqlbase/src/client/model/base.ts`: `select` (columns only), `where` (`eq/neq/gt/gte/lt/lte/in/between/exists/beginsWith/endsWith/contains` plus `and/or/not`, or value shorthand), `orderBy` (object of field → `asc|desc`, relies on key insertion order), `distinct`, `limit`, `offset`, `join` (relations only). No count or aggregate, no keyset helpers, no row-value comparison in `sql.*`. **No default limit is applied** — the operations factory passes `limit` through unchanged. (The JSDoc used to promise a default of 100; it was wrong and has been removed.)

## Known gaps (fix, do not design around)

| Gap | Where | Affects |
|---|---|---|
| Codec not applied to where-clause values | `normalizer.ts` → `sql.eq/...` | any codec that changes wire format; see [Codec boundary](./codec-boundary.md) |
| Composite PK invisible at runtime | `runtime/table.ts` | pagination tiebreakers, node lookup |
| First-column-only relation joins | `operation.ts` | composite relations |
| No table aliasing in joins | `query.ts` | self-joins, repeated tables |
| `_validateWhereExpression` stub | `operation.ts` | predicate injection seam |
| No hooks / derived-client factory | `context.ts`, `transaction-client.ts` | tenancy/identity scoping |

When a proposal needs one of these, name the fix as a prerequisite story. Public API may change; call out the changeset level.

## Related

- [Architecture](./architecture.md)
- [Codec boundary](./codec-boundary.md)
- [Querying (guide)](../guide/querying.md)
