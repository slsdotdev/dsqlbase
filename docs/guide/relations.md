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

## What relations do not do

- **No foreign keys are emitted.** Relations are a runtime construct; the migration module ignores them. Declaring `belongsTo` does not create a `REFERENCES` clause. If you want referential integrity in the database, that is a schema feature tracked separately (see [DSQL capabilities](../internals/dsql-capabilities.md) — DSQL does support FKs now).
- **Relation pairs are not validated when the client is built.** Every `from[i]` / `to[i]` pair is correlated at query time, but a relation whose sides differ in length or type is only caught then, not at `createClient`. This is a known gap listed in [Runtime pipeline](../internals/runtime-pipeline.md).
- **Joins are only allowed on declared relations.** Ad-hoc joins go through `$query` with the `sql` tag.

## Related

- [Schema](./schema.md)
- [Querying](./querying.md)
