# Row policies

_Audience: application developers._

Aurora DSQL has no row-level security: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` are refused ([DSQL capabilities](../internals/dsql-capabilities.md)). `dsqlbase` enforces **row policies** itself, while it builds each statement, below the point where you write queries — so a policy applies to a `findMany()` with no arguments, a join three levels down and a node lookup alike. You cannot forget it, because you never write it.

Policies are declared the way PostgreSQL declares RLS (`CREATE POLICY name ON t AS … FOR … USING (…) WITH CHECK (…)`), so the same definitions can become DDL if DSQL ships RLS.

## Settings

A policy compares rows with **settings**: per-request values, such as who the user is and which workspace they act in. Declare them once, with column builders, in a module of their own:

```ts
// settings.ts
import { settings, uuid } from "dsqlbase/schema";

export const params = settings({
  userId: uuid("identity.user_id"),
  workspaceId: uuid("identity.workspace_id"),
});
```

A policy or `$onCreate` reads one through `settings` — `params.settings.userId` — as it reads a table's columns through `columns`. The column's name (`identity.user_id`) is the key a native policy would read through `current_setting()`; its type and codec type and encode the value. Settings are not schema objects — they produce no DDL — so keep them out of the module you hand to `createClient({ schema })` and the migration runner, which take only definitions.

## Declaring policies

```ts
import { sql } from "dsqlbase";
import { table, text, uuid } from "dsqlbase/schema";
import { params } from "./settings";

export const documents = table("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .readOnly()
    .$onCreate(() => params.settings.workspaceId),
  ownerId: uuid("owner_id")
    .notNull()
    .$onCreate(() => params.settings.userId),
  title: text("title").notNull(),
});

documents.policy("workspace_isolation", (t) => ({
  as: "restrictive",
  using: sql`${t.workspaceId} = ${params.settings.workspaceId}`, // check defaults to using
}));

documents.policy("members_read", () => ({ for: "select", using: sql`true` }));

documents.policy("owner_writes", (t) => ({
  for: ["update", "delete"],
  using: sql`${t.ownerId} = ${params.settings.userId}`,
}));

documents.policy("members_insert", (t) => ({
  for: "insert",
  check: sql`${t.ownerId} = ${params.settings.userId}`,
}));
```

| Field          | Values                                                                   | Default                      | RLS equivalent       |
| -------------- | ------------------------------------------------------------------------ | ---------------------------- | -------------------- |
| name (1st arg) | an identifier, unique per table                                          | required                     | `CREATE POLICY name` |
| `as`           | `"permissive"` / `"restrictive"`                                         | `"permissive"`               | `AS`                 |
| `for`          | `"all"` / `"select"` / `"insert"` / `"update"` / `"delete"`, or an array | `"all"`                      | `FOR`                |
| `using`        | an `sql` condition                                                       | —                            | `USING`              |
| `check`        | an `sql` condition                                                       | `using`, for insert / update | `WITH CHECK`         |

The callback receives the table's runtime columns and runs once, when the client is built, so `${t.ownerId}` renders under whatever alias the level reading it uses. Policies are not DDL: migrations never see them.

When the client is built, a policy is refused if it has:

- `using` on a policy only for insert, which has no existing row to filter;
- `check` on a policy only for select or delete, which write nothing;
- no `using` when it covers select, update or delete;
- no check (declared, or `using`) when it covers insert or update.

A duplicate or non-identifier name is refused at definition time.

## How policies combine

A table with **at least one** policy denies by default. For a command, take the policies whose `for` covers it:

```
allowed(row) = (OR of permissive) AND (AND of restrictive)
```

With no permissive policy for a command, nothing is allowed: reads return nothing, writes fail. A table with no policies is unrestricted.

| Command                                                                | Rows it can see (`using`) | Rows it may write (`check`) |
| ---------------------------------------------------------------------- | ------------------------- | --------------------------- |
| select — every level of a join, union branch, count, page, node lookup | select                    | —                           |
| insert                                                                 | —                         | insert                      |
| update                                                                 | update **and** select     | update                      |
| delete                                                                 | delete **and** select     | —                           |

Rows `using` rejects are skipped **silently**, as in RLS: an `update` of a row you cannot see returns `null` and changes nothing. Only a failing `check` throws.

Put the boundary — the workspace, the tenant — in a **restrictive** policy. Permissive policies OR together, and `(owner_id = $1 OR shared)` can stop the planner using an index that leads with `workspace_id`; a restrictive boundary is AND-ed and keeps it usable. Lead the table's indexes with that column.

## Per-request clients

Give a request its values by deriving a client:

```ts
const db = dsql.$settings({ userId: jwt.sub, workspaceId: jwt.ws });

await db.documents.findMany({});
// SELECT … FROM "documents" AS "__t0"
// WHERE (true) AND ("__t0"."workspace_id" = $1)
```

`$settings` builds a new execution context and attaches its own models; it holds no connection and needs no reset. Concurrent requests cannot see each other's values, and a query's SQL is fixed by the client that built it — batched into another client's `$transaction([...])`, it keeps its settings.

- Declared settings are typed; any other key is accepted too, so `{ ...jwt.claims }` works.
- Calling `$settings` on a client that already carries settings merges: the new values are laid over the old, and `null` unsets one. `db.$settings({ userId: other })` keeps `workspaceId`.
- A client with settings is the same client as one without — same models, same `$query` / `$execute`, same `$transaction`.
- Transactions opened on it inherit its settings.

## Unset settings

A request may carry some settings, all, or none. **Nothing refuses a missing setting: it renders as `NULL`, and the policy decides** — the same as `current_setting(key, true)` in native RLS.

- In `using`, `col = NULL` is never true. A restrictive policy over an unset setting hides every row; in a permissive OR, an unset setting only drops its own branch.
- In `check`, `NULL` fails: the write is refused.
- `$onCreate(() => params.settings.workspaceId)` with the setting unset inserts `NULL`, which a `notNull` column refuses (`23502`).

So a missing setting gives an empty result or a refused write, not an early error naming it. **Never turn `NULL` into true** in a policy — `setting IS NULL OR …` opens every row to a request that left the setting out. Compare settings with `=` and let `NULL` block.

## Filling columns from settings

`$onCreate` may return a setting. The column is filled from the client's value on every insert that does not name it:

```ts
workspaceId: uuid("workspace_id").notNull().readOnly().$onCreate(() => params.settings.workspaceId),
```

With `.readOnly()` the column is out of `create` / `update` input altogether — the types drop it and a value spread into `data` is ignored — so it always comes from the setting. The value is encoded by the setting's column, not validated by the target's `.schema()`; the policy is the guard. Migrations never read `$onCreate`, so the column has no `DEFAULT` in the database. Moving a row to another workspace is stopped by the check, which defaults to `using`.

## Errors

A write whose new row fails a check throws `PolicyViolationError`, and **nothing** the statement would have written is written — a multi-row write and every row of an `updateMany` included:

```ts
import { PolicyViolationError } from "dsqlbase";

try {
  await db.documents.update({ where: { id }, set: { ownerId: someoneElse } });
} catch (error) {
  if (error instanceof PolicyViolationError) {
    error.table; // "documents" — the schema alias
    error.command; // "update"
    error.as; // "permissive": no permissive policy passed; "restrictive": one failed
    error.policies; // ["owner_writes"]
  }
}
```

The message names the table and policies, never a row's values; the driver's error is `cause`. Inside `$transaction` the error rolls the whole transaction back and is rethrown — it is not retried like an OCC conflict.

## Bypassing policies

A worker, a migration script or an admin job can skip every policy:

```ts
const internal = createClient({ schema, session, settings: params, policies: { bypass: true } });
```

It is the `BYPASSRLS` analogue, set per client and inherited by everything derived from it — never per call, because a per-call escape hatch is a thing to forget. Settings still render: an unset one still fills `NULL`, and `notNull` still refuses it.

Raw SQL (`$query` / `$execute`) is never policed, on any client: settings bind only into statements the client builds, and a `sql` template renders without them.

## What a policy can and cannot express

|                                      | Native RLS                     | Here                                                      |
| ------------------------------------ | ------------------------------ | --------------------------------------------------------- |
| The row's own columns                | yes                            | yes                                                       |
| Per-request values                   | `current_setting()`            | settings, bound as parameters                             |
| A subquery on another table          | yes, under that table's RLS    | yes, but **that table's policies do not apply inside it** |
| A subquery on the **same** table     | yes                            | **no** — its columns render under the outer level's alias |
| Roles (`TO`)                         | matched against `current_user` | not supported yet                                         |
| The old row in `check`               | no                             | no                                                        |
| Defaulted columns in an insert check | yes                            | yes                                                       |
| Raw SQL                              | policed                        | not policed                                               |
| Functions                            | SQL and PL/pgSQL               | `LANGUAGE sql` only on DSQL                               |

Two more differences:

- A `belongs-to` a union with no discriminator column finds the member by probing each member for the key. The probe reads the members **without** their policies: it only says which member holds a key the row already carries. The join itself applies them.
- A `where` you pass as a raw `sql` fragment runs beside the policies, not after them; a fragment that errors on some rows can reveal they exist. The structured `where` has no such issue.

## Related

- [Schema](./schema.md) — `.policy()`, `$onCreate`
- [Querying](./querying.md)
- [Transactions](./transactions.md)
- [Runtime pipeline → The `WHERE` seam](../internals/runtime-pipeline.md#the-where-seam)
- [0024 — Row policies](../decisions/0024-row-policies.md)
