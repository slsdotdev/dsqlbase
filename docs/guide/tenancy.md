# Tenancy

_Audience: application developers._

A tenant table carries a column identifying who owns each row — a workspace, an organisation, an account — and every read has to be filtered by it, every write has to set it. Doing that by hand works until the one place it is forgotten, and that failure is silent: the query returns another tenant's rows, or writes a row into no tenant at all.

Aurora DSQL offers nothing underneath to catch it. There is no row-level security and permissions are schema-level grants ([DSQL capabilities](../internals/dsql-capabilities.md)), so the ORM is the last line of defence rather than a convenience. `dsqlbase` therefore applies the boundary *below* the point where you write queries: you cannot forget it, because you never write it.

## Declaring the boundary

```ts
import { namespace, table, tenantScope, text, uuid } from "dsqlbase/schema";

export const ws = tenantScope({
  workspaceId: uuid("workspace_id").notNull(),
});

export const workspaces = table("workspaces", {        // global: no claim columns
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const invoices = ws.table("invoices", {         // the claim columns are merged in
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});
```

`ws.table(name, columns)` is sugar. For any other constructor — a namespaced table, say — spread the claim columns instead:

```ts
const app = namespace("app");

export const audit = app
  .table("audit", {
    ...ws.columns(),
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
  })
  .primaryKey((c) => [c.workspaceId, c.id]);
```

`ws.columns()` returns fresh column instances on every call, so one scope serves any number of tables. Exporting `ws` from the schema module alongside the tables is fine — it is not a database object and no migration sees it.

Rules:

- **Every claim column must be `notNull`.** The runtime fills it on each insert, so it is never absent. `tenantScope()` throws otherwise, and so does `table()` for a claim column configured any other way.
- **A table may not redeclare a claim.** `ws.table("invoices", { workspaceId: … })` throws.
- **The claim key is the field name** (`workspaceId`), not the column name. Two scopes declaring the same field name declare the same claim, and it must have the same type on every table that declares it — checked when the client is built.
- **A claim is a field like any other**, so it may not collide with a relation name.
- **A composite primary key including the claim is allowed** — `(workspace_id, id)` is a common shape. Note that such a table is not a `Node` for global ids.
- **No index is created for you.** A claim column is almost always the leading column of an index the application declares anyway; do declare one, leading with the claim: `invoices.index("invoices_workspace_idx").columns((c) => [c.workspaceId, c.id])`.

## Scoping a client

```ts
export const dsql = createClient({ schema, session });   // enforcing, the default

dsql.workspaces.findMany({});   // fine — global table
dsql.invoices;                  // type error: the property does not exist

const db = dsql.$identityClaims({ workspaceId: claims.workspace_id });

await db.invoices.findMany({});
// SELECT … FROM "invoices" WHERE "invoices"."workspace_id" = $1

await db.invoices.create({ data: { number: "INV-1" } });
// workspace_id filled from the claim; it is not part of `data`

await db.workspaces.findMany({ join: { invoices: true } });
// the predicate applies inside the lateral too
```

`$identityClaims` **derives** a client rather than changing the one it was called on, so a process holds one base client and builds a scoped one per request. Claims are picked out of the argument by name, so a decoded token can be handed over whole:

```ts
const db = dsql.$identityClaims({ ...jwt.claims, workspaceId: jwt.claims.workspace_id });
```

Anything the schema does not declare is ignored. A declared claim given as `null` or `undefined` throws, because that is a mapping bug rather than a narrower scope. Leaving a claim out is allowed and simply narrows what the client can reach: a table needing a claim the identity does not carry is absent from the client's type, and throws if reached at runtime.

A misspelled claim inside a spread cannot be caught at that point — there is nothing to compare it against — and surfaces as a `TenancyError` at the first tenant table it fails to scope.

## What a scoped client can and cannot do

| | Scoped client |
|---|---|
| Read, filter, order by a claim column | yes |
| Write a claim column | no — it is not part of `data` or `set`, and a spread-in value is dropped |
| `$query` / `$execute` | no — raw SQL bypasses the predicate, so it is not offered |
| `$identityClaims` again | no — claims are set in exactly one place |
| `$transaction` | yes, and the transaction inherits the scope |

Filtering by the claim cannot widen the scope. `db.invoices.findMany({ where: { workspaceId: other } })` becomes `workspace_id = $claim AND workspace_id = $other` — an empty result, never another tenant's rows.

## Processes that run unscoped

An internal worker is a separate deployment from a request handler, so the switch is per client rather than per call:

```ts
export const dsql = createClient({ schema, session, tenancy: { enforce: false } });

await dsql.invoices.findMany({});                       // every workspace
await dsql.invoices.create({ data: { number } });       // TenancyError — nothing to fill
await dsql.$identityClaims({ workspaceId }).invoices.create({ data: { number } });  // the way to create
```

**Inserting always requires claims**, in both modes: the column is `notNull` and nothing else can fill it, so an unscoped insert would write a row into no tenant. Moving a row between tenants is deliberately not a model-client operation:

```ts
await dsql.$execute(
  sql`UPDATE "invoices" SET "workspace_id" = ${to} WHERE "id" = ${id}`.toQuery()
);
```

Pass `enforce` as a literal, or leave it out. A variable typed `boolean` widens the inferred type and the tenant tables stay visible in the client's type; the runtime still enforces, so this is a false promise rather than a leak, but the compile-time help is lost ([0005](../decisions/0005-tenant-client-visibility.md)).

## Transactions

Scope first, then open the transaction. A transaction client cannot be scoped.

```ts
await db.$transaction(async (tx) => {
  await tx.invoices.create({ data: { number: "INV-2" } });
});
```

Batching a scoped query into an unscoped transaction is safe: `ExecutableQuery` has its SQL fixed when the scoped client builds it, and batching only swaps the session it runs on.

```ts
await dsql.$transaction([db.invoices.findMany({})]);   // still scoped
```

## Per-request wiring

One derivation per request, in a middleware, with the mapping from token claim names to schema claim names owned by the application:

```ts
const withTenant = () => ({
  before: (request) => {
    request.context.db = dsql.$identityClaims({
      workspaceId: request.event.requestContext.authorizer.jwt.claims.workspace_id,
    });
  },
});
```

Resolvers then use only `context.db`, and nothing downstream can reach across tenants.

## Failure modes

| Situation | Behaviour |
|---|---|
| Claim column without `notNull` | throws at `tenantScope()`, and at `table()` for a claim configured another way |
| A table redeclares a claim | throws at definition |
| One claim name with two data types across tables | throws when the client is built |
| Claim name equal to a relation name | throws when the client is built |
| Tenant table on an enforcing client, at the root | type error; `TenancyError` when the query is built |
| Tenant table reached through a join with no claims | `TenancyError` — the types cannot see a nested level, the runtime can |
| Insert into a tenant table with no claims, either mode | `TenancyError` |
| Scoped client missing one of a table's claims | table absent from the type; `TenancyError` if reached |
| `$identityClaims` with a claim set to `null` / `undefined` | throws |
| `$identityClaims` with keys the schema does not declare | ignored |
| Misspelled claim in a spread | surfaces at the first tenant table it cannot scope |
| `$identityClaims` on an already scoped client | throws |
| Claim column in `data` / `set` | dropped; the claim wins. Type error for a literal |
| `$query` / `$execute` on a scoped client | type error; `TenancyError` at runtime |
| `where` on the claim column with another tenant's value | empty result |

Errors are thrown when the query is **built** — when `findMany()` is called — not when it is executed, so a missing identity surfaces before anything reaches the database.

## Related

- [Schema](./schema.md)
- [Querying](./querying.md)
- [Relations](./relations.md)
- [Transactions](./transactions.md)
- [0005 — Tenant table visibility on the client](../decisions/0005-tenant-client-visibility.md)
- [DSQL capabilities](../internals/dsql-capabilities.md)
