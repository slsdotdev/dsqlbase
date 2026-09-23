# Relations

_Audience: application developers._

Relations declare how tables join so the client can load related rows with `join`. They are defined separately from tables, so tables can reference each other without import cycles. Source: `packages/dsqlbase/src/schema/relations.ts`, model in `packages/core/src/definition/relations.ts`.

```ts
import { relations, hasMany, hasOne, belongsTo } from "dsqlbase/schema";

export const userRelations = relations(users, {
  tasks: hasMany(tasks, {
    from: [users.columns.id],
    to: [tasks.columns.assigneeId],
  }),
  membership: hasOne(members, {
    from: [users.columns.id],
    to: [members.columns.userId],
  }),
});

export const taskRelations = relations(tasks, {
  assignee: belongsTo(users, {
    from: [tasks.columns.assigneeId],
    to: [users.columns.id],
  }),
});
```

- `hasMany` → the joined field is an array (`json_agg`).
- `hasOne` and `belongsTo` → the joined field is a single object or `null` (`row_to_json`).
- `from` is on the source table, `to` on the target; both are arrays, and every pair is correlated.
- **Multi-column relations work.** Every `from[i]` / `to[i]` pair is correlated, so a relation can key on more than one column:

```ts
export const taskRelations = relations(tasks, {
  assigneeMembership: belongsTo(members, {
    from: [tasks.columns.teamId, tasks.columns.assigneeId],
    to: [members.columns.teamId, members.columns.userId],
  }),
});
```

  `createClient` rejects a relation whose sides differ in length, whose columns are not declared on the side they are listed under, or whose paired columns have different types.
- **A relation may point at its own table.** `parent: belongsTo(tasks, { from: [tasks.columns.parentId], to: [tasks.columns.id] })` works: each level of a query is rendered under its own alias, so the two sides stay distinct. The same holds for joining two tables that share a name in different schemas.

Use them in queries:

```ts
const user = await dsql.users.findOne({
  where: { id: { eq: userId } },
  join: {
    tasks: { where: { status: { eq: "todo" } }, orderBy: { createdAt: "desc" }, limit: 10 },
    membership: true,
  },
});
```

Nested `where` / `select` / `orderBy` / `limit` / `join` all work inside a join, because each join is a full sub-select. See [Querying](./querying.md).

- **A relation may not be named after a column of the same table.** Columns and relations share one field namespace, because `select`, `join` and the keys of a result row all address them as fields of the same model. `createClient` throws when they collide, naming both.
- **`$$meta` and `$$key` are reserved.** A relation of either name throws when the client is created; the runtime writes them onto result rows itself. See [`$$meta`](./querying.md#meta-on-every-row).

## Relations across a tenant boundary

A relation may cross between a [tenant-scoped](./tenancy.md) table and a global one in either direction, and nothing about declaring it changes. What changes is what a scoped client sees through it:

- **A tenant target is filtered.** Joining from a global table to a tenant one applies the tenant predicate inside that level's lateral, on top of the join correlation. A global row whose children belong to another tenant comes back with an empty array.
- **A global target is not.** Joining from a tenant table back to a global one adds nothing; the correlation is the only condition.
- **Every level is its own decision.** A tenant table two levels down is filtered as much as one directly below the root.
- **A join is where the types cannot help.** A nested level is named by a relation rather than by the client, so an enforcing client with no claims cannot be stopped at compile time from reaching a tenant table through one. The runtime refuses it instead, with a `TenancyError` when the query is built.

Correlating *on* the claim column — `workspaces.id` to `invoices.workspaceId` — is common and works, but note that such a join is already narrowed by its correlation. It is the relations that correlate on something else, like an author or an owner, where the tenant predicate is the only thing keeping another tenant's rows out.

## What relations do not do

- **No foreign keys are emitted.** Relations are a runtime construct; the migration module ignores them. Declaring `belongsTo` does not create a `REFERENCES` clause. If you want referential integrity in the database, that is a schema feature tracked separately (see [DSQL capabilities](../internals/dsql-capabilities.md) — DSQL does support FKs now).
- **Joins are only allowed on declared relations.** Ad-hoc joins go through `$query` with the `sql` tag.

## Related

- [Schema](./schema.md)
- [Querying](./querying.md)
- [Tenancy](./tenancy.md)
