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

- **A table's relations may be split across several `relations()` blocks** — say, one per
  module. They are merged into one set, in the types as at runtime; declaring the same relation
  name in two blocks is rejected by `createClient`.
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

## Relations to a union

Any relation can target a [`union()`](./schema.md#unions) instead of a table. `to` then names
the key on the members, in one of two forms:

```ts
export const userRelations = relations(users, {
  // A shared field: resolves to each member's own column.
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),

  // One list per member, for members that store the key under different fields.
  owned: hasMany(posts, {
    from: [users.columns.id],
    to: { photos: [photos.columns.ownerId], videos: [videos.columns.userId] },
  }),
});
```

A **belongs-to a union** also names a `discriminator`: a text column on the source that holds
which member each row points at, as that member's schema alias. It is required there, and
`createClient` refuses it anywhere else. A has-many or has-one to a union needs none, because
the key lives on the members.

```ts
export const comments = table("comments", {
  id: guid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type"), // "photos" or "videos"
  subjectId: uuid("subject_id"),
});

export const commentRelations = relations(comments, {
  subject: belongsTo(posts, {
    from: [comments.columns.subjectId],
    to: [posts.columns.id],
    discriminator: comments.columns.subjectType,
  }),
});
```

`createClient` checks every member: the columns must be declared on that member and pair with
`from` by type, and a per-member map must name each member exactly once. A list given in
the first form may only hold the union's shared fields.

## Relations between global-id columns

Both sides of every column pair must agree about global ids: both [`guid()`](./global-ids.md)
columns naming the same node, or neither. `createClient` throws otherwise, naming both columns.

Neither failure shows up in SQL — a join correlates on the raw columns, so the query works
either way. What breaks is quieter. A `guid()` paired with a plain `uuid()` leaves
`article.authorId` raw while `article.author.id` comes back wrapped, so the two never compare
equal; two `guid()` columns naming different nodes produce two different strings for one row.

The usual mistake is the first one: adding a relation to a node table and leaving the foreign
key as `uuid()`.

## Relations across a tenant boundary

A relation may cross between a [tenant-scoped](./tenancy.md) table and a global one in either direction, and nothing about declaring it changes. What changes is what a scoped client sees through it:

- **A tenant target is filtered.** Joining from a global table to a tenant one applies the tenant predicate inside that level's lateral, on top of the join correlation. A global row whose children belong to another tenant comes back with an empty array.
- **A global target is not.** Joining from a tenant table back to a global one adds nothing; the correlation is the only condition.
- **Every level is its own decision.** A tenant table two levels down is filtered as much as one directly below the root.
- **A join is where the types cannot help.** A nested level is named by a relation rather than by the client, so an enforcing client with no claims cannot be stopped at compile time from reaching a tenant table through one. The runtime refuses it instead, with a `TenancyError` when the query is built.

Correlating _on_ the claim column — `workspaces.id` to `invoices.workspaceId` — is common and works, but note that such a join is already narrowed by its correlation. It is the relations that correlate on something else, like an author or an owner, where the tenant predicate is the only thing keeping another tenant's rows out.

## What relations do not do

- **No foreign keys are emitted.** Relations are a runtime construct; the migration module ignores them. Declaring `belongsTo` does not create a `REFERENCES` clause. If you want referential integrity in the database, that is a schema feature tracked separately (see [DSQL capabilities](../internals/dsql-capabilities.md) — DSQL does support FKs now).
- **Joins are only allowed on declared relations.** Ad-hoc joins go through `$query` with the `sql` tag.

## Related

- [Schema](./schema.md)
- [Querying](./querying.md)
- [Tenancy](./tenancy.md)
