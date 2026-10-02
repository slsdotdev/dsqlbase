# Querying

_Audience: application developers._

`createClient({ schema, session })` returns a client with one model per exported table, one read-only client per exported [`union()`](./polymorphic-relations.md#reading-a-union-directly), plus a few `$`-prefixed escape hatches. Source: `packages/dsqlbase/src/client/`.

```ts
import { createClient } from "dsqlbase";
import { createPgSession } from "dsqlbase/pg";
import * as schema from "./schema";

export const dsql = createClient({ schema, session: createPgSession(pool) });
```

Models are keyed by the **export name** in `schema`, not by the table name: `export const users = table("app_users", …)` is reached as `dsql.users`.

## Model methods

Every method returns a query that runs when awaited — an `ExecutableQuery`, or for a counted page a `CompositeQuery` of two statements. `await` it to run it, or pass it unawaited to `$transaction([...])` (see [Transactions](./transactions.md)).

| Method                            | Args                                            | Returns                                  |
| --------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `findOne(args)`                   | `where` (required), `select`, `join`            | one row or `null`                        |
| `findMany(args)`                  | `QueryArgs` (below)                             | array of rows                            |
| `paginate(args)`                  | see [Pagination](./pagination.md)               | a page of rows with cursors              |
| `count(args?)`                    | `where`                                         | number                                   |
| `create({ data, return? })`       | column values; `return` selects what comes back | created row, selected fields, or nothing |
| `update({ set, where, return? })` |                                                 | updated rows                             |
| `delete({ where, return? })`      |                                                 | deleted rows                             |

`create` / `update` / `delete` always require `where` (except `create`) — there is no "delete everything" form.
An empty `where: {}` does not count: `findOne`, `update` and `delete` refuse it when the query is built,
before any SQL runs.

Columns marked [`.readOnly()`](./schema.md) are not part of `data` or `set`: the types exclude
them, and a value that reaches them through an untyped spread is dropped. They stay fully
readable — `select`, `where`, `orderBy` and the result row are unaffected.

On a client scoped with `$identityClaims`, every one of these methods also carries a tenant
predicate. It is AND-ed in **ahead of** the `where` you wrote, at the root and at every joined
level:

```sql
SELECT … FROM "invoices"
WHERE ("invoices"."workspace_id" = $1) AND ("invoices"."number" LIKE $2)
```

The claim column is filterable and orderable like any other, but filtering by it cannot widen
the scope — `where: { workspaceId: other }` becomes two conflicting equalities and returns
nothing. Reaching a tenant table from a client with no claims throws a `TenancyError` when the
query is built, including through a join, which the types cannot see. See
[Tenancy](./tenancy.md).

## `QueryArgs`

Defined in `packages/dsqlbase/src/client/model/base.ts` (the JSDoc there is the most detailed reference).

```ts
const tasks = await dsql.tasks.findMany({
  select: { id: true, title: true, status: true },
  where: {
    and: [
      { status: { in: ["todo", "in_progress"] } },
      { or: [{ assigneeId: { eq: userId } }, { assigneeId: { exists: false } }] },
      { not: { title: { beginsWith: "WIP" } } },
    ],
  },
  orderBy: { dueDate: "asc", createdAt: "desc" },
  limit: 20,
  offset: 40,
  distinct: false,
  join: { project: { select: { name: true } } },
});
```

- **`select`** — columns, column groups (`true` or a map of their members — see [Embedded objects](./embeddable-objects.md#reading)), and relations as field maps (below). Virtual or computed fields are not supported yet.
  - **No `select`**, or one naming nothing as `true` (`{}`, `{ id: false }`), returns every column.
  - **Naming columns** returns those columns.
  - **Naming only relations** returns only those relations, with no columns of the row itself.
- **`where`** — per field, the operators its column type allows (below); combinators `and`, `or`, `not`. Several operators on one field all apply, AND-ed: `{ pages: { gte: 1, lte: 5 } }`. An operator set to `undefined` is skipped.
  An empty `where: {}` — or an empty `and` / `or` group — filters nothing, the same as leaving it out.
  Comparison values are written the same way the column stores them, so you filter a `date` column with a JS `Date`, a `bigint` column with a `bigint`, and an `interval` column with a `Duration` or ISO string. On a string column, `beginsWith` / `endsWith` / `contains` build a `LIKE` pattern and are not converted; on a `jsonb` column, `contains` takes a fragment of the document (below).
- **`orderBy`** — object of field → `"asc" | "desc"`; ordering follows key insertion order. Only columns whose type can be ordered (below).
- **`limit` / `offset`** — **no default limit is applied.** A `findMany` without `limit` returns every matching row.
- **`distinct`** — `SELECT DISTINCT` over the selected columns. A `json` column has no equality and is refused, so `distinct` throws when one is selected — including when nothing is named and every column is. A `jsonb` column is compared.
- **`join`** — declared relations only, with their own `where` / `orderBy` / `limit` / `offset`; `true` or a nested `QueryArgs` (see [Relations](./relations.md)). A relation to a `union()` takes shared-field arguments plus a per-member `on` map, and its rows carry `$$key` (see [Polymorphic relations](./polymorphic-relations.md)).

### Operators by column type

Every column has a runtime type: the kind of value it holds, for querying. It decides which
operators a filter on the column takes, whether a bare value stands for `eq`, and whether the
column can be an `orderBy` key. The types and the runtime follow the same table: an operator the
types refuse also throws when the query is built, before any SQL runs, for a caller the types
cannot see (a resolver passing arguments through).

| Runtime type | Columns                                                    | Operators                                                                                   | Bare value | `orderBy` |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- | --------- |
| `string`     | `text`, `varchar`, `char`, `domain()`, `$enum()`           | `eq` `neq` `in` `gt` `gte` `lt` `lte` `between` `exists` `beginsWith` `endsWith` `contains` | yes        | yes       |
| `uuid`       | `uuid`, `guid`                                             | `eq` `neq` `in` `gt` `gte` `lt` `lte` `between` `exists`                                    | yes        | yes       |
| `number`     | `int`, `smallint`, `real`, `double`, `numeric`, `identity` | same as `uuid`                                                                              | yes        | yes       |
| `bigint`     | `bigint`                                                   | same as `uuid`                                                                              | yes        | yes       |
| `date`       | `date`, `time`, `timestamp` (in any read mode)             | same as `uuid`                                                                              | yes        | yes       |
| `interval`   | `interval`                                                 | same as `uuid`                                                                              | yes        | yes       |
| `boolean`    | `boolean`                                                  | `eq` `neq` `exists`                                                                         | yes        | yes       |
| `bytes`      | `bytea`                                                    | `exists`                                                                                    | no         | no        |
| `json`       | `json`                                                     | `exists`                                                                                    | no         | no        |
| `jsonb`      | `jsonb`                                                    | `eq` `neq` `contains` `exists`                                                              | no         | no        |
| `array`      | `array`                                                    | `eq` `neq` `contains` `exists`                                                              | no         | no        |
| `object`     | `record`                                                   | `eq` `neq` `contains` `hasKey` `exists`                                                     | no         | no        |

- **A bare value** is shorthand for `eq`. A plain object counts as operators when it names one;
  one that names none is a value (an `interval` read as a `Duration`).
- **Document, array and binary columns take no bare value.** `{ settings: { theme: "dark" } }`
  could be a document or a filter; it throws, asking for one of the column's operators.
- **`jsonb` filters compare documents.** `eq` / `neq` take a whole document, compared as
  Postgres compares `jsonb`: object keys in any order, array items in order. `contains` is
  containment (`@>`): the document holds the fragment, matched recursively — an object by the
  keys the fragment names, at any depth, an array as a subset in any order.
  `{ layout: { contains: { panels: [{ id: 1 }] } } }` matches a layout with a panel whose `id`
  is `1`, whatever else it holds. The fragment is typed as a partial of the document and sent as
  given; a column's `.schema()` does not validate it. The same holds for `array()` and `record()`
  columns, both `jsonb`. On an `array()` the fragment is always an array of items —
  `{ tags: { contains: ["a", "b"] } }` matches arrays holding both — never a lone item.
- **`hasKey`** on a `record()` column matches objects with the key at their top level (`?`):
  `{ limits: { hasKey: "cpu" } }`.
- **`where`** inside a field's filter is the nested filter. A column group takes it, with
  `exists`: `{ netValue: { where: { amount: { gt: 100n } } } }` — see
  [Embedded objects](./embeddable-objects.md#filtering-and-ordering). Inside a column's filter it
  is reserved for filtering into a document's keys, later, and throws "not supported yet".
- **Across a union**, a shared field filters and orders as its column does in every member.

### Relations in `select`

A relation can be named in `select` like a column, as `true` (every column of the related row)
or as a field map over the related table, which may name that table's relations in turn. It is
read exactly as the same relation in `join`, so the SQL and the result are identical:

```ts
const tasks = await dsql.tasks.findMany({
  select: { id: true, title: true, project: { name: true, owner: { email: true } } },
});
// same as
const same = await dsql.tasks.findMany({
  select: { id: true, title: true },
  join: { project: { select: { name: true }, join: { owner: { select: { email: true } } } } },
});

await dsql.tasks.findOne({ where: { id: { eq: id } }, select: { project: true } });
// { $$meta, project: { …every project column } | null } — no task columns
```

- A field map takes fields only. A relation that needs `where`, `orderBy`, `limit` or `offset`
  is written in `join`.
- A relation to a [`union()`](./polymorphic-relations.md) takes the union's shared fields; select
  a member's own fields through `join` and `on`.
- Naming the same relation in both `select` and `join` is refused: a type error at the call, and
  an error when the query is built (at any depth). A `false` in `join` beside it is ignored.
- `return` on `create` / `update` / `delete` takes columns only.

For cursor pagination and counts, use [`paginate` and `count`](./pagination.md) rather than
`offset`. There is no aggregate helper beyond `count`; use `$query` for the rest.

## `$$meta` on every row

Every result record carries a `$$meta` property describing the table it came from — rows from
`findOne` / `findMany`, rows of a joined level, and rows returned by `create` / `update` /
`delete` with `return`:

```ts
const task = await dsql.tasks.findOne({
  where: { id: { eq: id } },
  select: { id: true, title: true },
  join: { project: { select: { name: true } } },
});

task?.$$meta; // { key: "tasks", table: "tasks" }
task?.project?.$$meta; // { key: "projects", table: "projects" } — its own, not the parent's
```

- **`key`** — the name the table is exported under in the schema object, which is how the
  client addresses it (`dsql.members`). It is typed as the literal alias, not `string`.
- **`table`** — the database table name, which may differ (`team_members`).
- **`schema`** — present only when the table declares a namespace.

`$$meta` is an ordinary enumerable property, so it survives `{ ...row }` and `JSON.stringify`.
It is the first key on each record. A whole-row `toEqual` in your tests must account for it.

Add your own fields with [`table().meta()`](./schema.md#table-metadata):

```ts
const tasks = table("tasks", {
  /* … */
}).meta({ __typename: "Task" });

task?.$$meta.__typename; // "Task", typed
```

`$$meta` and `$$key` are reserved: a column or relation of either name throws.

`$$meta.key` is typed as the literal alias, but it **cannot discriminate a union** —
TypeScript does not narrow on a nested property, so `row.$$meta.key === "users"` compiles and
narrows nothing. Where a result really is a union of tables, the row carries a top-level
`$$key` instead; see [Global ids](./global-ids.md).

## Escape hatches

```ts
import { sql } from "dsqlbase";

const rows = await dsql.$query<{ n: number }>(
  sql`select count(*)::int as n from ${sql.identifier("tasks")}`
);
const raw = await dsql.$execute<{ n: number }>({ text: "select 1 as n", params: [] });
```

Neither exists on a client scoped with `$identityClaims`: raw SQL bypasses every seam the
factory applies, the tenant predicate included, so it is offered only where that is plain to
read.

- `$query(SQLQuery)` — build with the `sql` tagged template; parameters are bound automatically. Returns an `ExecutableQuery`, so it can join a `$transaction([...])` batch.
- `$execute(SQLStatement)` — pass `{ text, params }` straight to the session.

Both bypass codecs and typing; results are whatever the driver returns. To filter by a column whose stored form differs from its JS value, wrap the value with `column.param(...)`:

```ts
await dsql.$query(
  sql`select * from "tasks" where ${tasks.columns.dueDate} > ${tasks.columns.dueDate.param(cutoff)}`
);
```

## Related

- [Embedded objects](./embeddable-objects.md)
- [Relations](./relations.md)
- [Pagination](./pagination.md)
- [Transactions](./transactions.md)
- [Global ids](./global-ids.md)
- [Tenancy](./tenancy.md)
- [Sessions](./sessions.md)
- [Runtime pipeline](../internals/runtime-pipeline.md) — how these calls become SQL
