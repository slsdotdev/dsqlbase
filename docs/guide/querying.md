# Querying

_Audience: application developers._

`createClient({ schema, session })` returns a client with one model per exported table plus a few `$`-prefixed escape hatches. Source: `packages/dsqlbase/src/client/`.

```ts
import { createClient } from "dsqlbase";
import { createPgSession } from "dsqlbase/pg";
import * as schema from "./schema";

export const dsql = createClient({ schema, session: createPgSession(pool) });
```

Models are keyed by the **export name** in `schema`, not by the table name: `export const users = table("app_users", …)` is reached as `dsql.users`.

## Model methods

Every method returns an `ExecutableQuery`; `await` it to run it, or pass it unawaited to `$transaction([...])` (see [Transactions](./transactions.md)).

| Method                            | Args                                            | Returns                                  |
| --------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `findOne(args)`                   | `where` (required), `select`, `join`            | one row or `null`                        |
| `findMany(args)`                  | `QueryArgs` (below)                             | array of rows                            |
| `create({ data, return? })`       | column values; `return` selects what comes back | created row, selected fields, or nothing |
| `update({ set, where, return? })` |                                                 | updated rows                             |
| `delete({ where, return? })`      |                                                 | deleted rows                             |

`create` / `update` / `delete` always require `where` (except `create`) — there is no "delete everything" form.

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

- **`select`** — real columns only; omit for all columns. Virtual or computed fields are not supported yet.
- **`where`** — per field: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `between`, `exists` (null check), `beginsWith`, `endsWith`, `contains`; combinators `and`, `or`, `not`. A bare value is shorthand for `eq`.
- **`orderBy`** — object of field → `"asc" | "desc"`; ordering follows key insertion order.
- **`limit` / `offset`** — **no default limit is applied.** A `findMany` without `limit` returns every matching row.
- **`distinct`** — `SELECT DISTINCT` over the selected columns.
- **`join`** — declared relations only; `true` or a nested `QueryArgs` (see [Relations](./relations.md)).

There is no `count`, aggregate, or keyset-pagination helper today; use `$query` for those.

## Escape hatches

```ts
import { sql } from "dsqlbase";

const rows = await dsql.$query<{ n: number }>(
  sql`select count(*)::int as n from ${sql.identifier("tasks")}`
);
const raw = await dsql.$execute<{ n: number }>({ text: "select 1 as n", params: [] });
```

- `$query(SQLQuery)` — build with the `sql` tagged template; parameters are bound automatically. Returns an `ExecutableQuery`, so it can join a `$transaction([...])` batch.
- `$execute(SQLStatement)` — pass `{ text, params }` straight to the session.

Both bypass codecs and typing; results are whatever the driver returns.

## Related

- [Relations](./relations.md)
- [Transactions](./transactions.md)
- [Sessions](./sessions.md)
- [Runtime pipeline](../internals/runtime-pipeline.md) — how these calls become SQL, and current gaps
