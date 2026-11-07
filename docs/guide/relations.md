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

When a relation needs no filter, order or limit, name it in `select` instead, as `true` or a field map — `select: { name: true, membership: { role: true } }` reads exactly as `join: { membership: { select: { role: true } } }`. See [Relations in `select`](./querying.md#relations-in-select).

- **A relation may not be named after a column of the same table.** Columns and relations share one field namespace, because `select`, `join` and the keys of a result row all address them as fields of the same model. `createClient` throws when they collide, naming both.
- **`$$meta` and `$$key` are reserved.** A relation of either name throws when the client is created; the runtime writes them onto result rows itself. See [`$$meta`](./querying.md#meta-on-every-row).

## Relations to a union

Any relation can target a [`union()`](./schema.md#unions) instead of a table. `to` then names
the key on the members, in one of two forms:

```ts
export const userRelations = relations(users, {
  // A shared field: resolves to each member's own column.
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),

  // One list per member, for a key the union does not share — stored under different fields.
  owned: hasMany(posts, {
    from: [users.columns.id],
    to: { photos: [photos.columns.ownerId], videos: [videos.columns.userId] },
  }),
});
```

A **belongs-to a union** may also name a `discriminator` ([details](./polymorphic-relations.md#a-belongs-to-a-union)): a text column on the source that holds
which member each row points at, as that member's schema alias. Without one, the member is the
first holding the key, computed when the query runs
([without a discriminator](./polymorphic-relations.md#without-a-discriminator)).
`createClient` refuses a discriminator anywhere else. A has-many or has-one to a union needs
none, because the key lives on the members.

```ts
export const comments = table("comments", {
  id: guid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type"), // "photos" or "videos"
  subjectId: guid("subject_id"), // the members' ids are guid(), so this is too
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
the first form may only hold fields the union declares.

Joining one — the shared `select` / `where` / `orderBy`, the per-member `on` map, and `$$key` on
every row — is covered in [Polymorphic relations](./polymorphic-relations.md).

## Relations declared on a union

`relations()` also takes a union as its source, which gives every member the relation from its
own column: `relations(posts, { reactions: hasMany(reactions, { from: [posts.columns.id], to:
[reactions.columns.postId] }) })`. `from` names the union's declared fields and the target must
be a table. See [Polymorphic relations](./polymorphic-relations.md#relations-declared-on-a-union).

## Relations between global-id columns

Both sides of every column pair must agree about global ids: both [`guid()`](./global-ids.md)
columns, or neither. `createClient` throws otherwise, naming both columns.

The relation is also what decides what a key column's ids name: the key side of a pair — the
`from` of a `belongsTo`, the `to` of a `hasMany` / `hasOne` — reads as the column it is paired
with, followed to where that chain ends, so `article.authorId === article.author.id` holds. Two
relations whose chains end at the same column agree (`orders.customerId` → `customers.id`, and
→ `customerStats.customerId` → `customers.id`). A column whose relations end at different
columns has no single answer, and `createClient` throws. Columns that reference each other in a
ring are refused for every column type, guid or not: the usual cause is a `hasOne` declared from
the table that holds the key (`hasOne(users, { from: [photos.columns.userId], to:
[users.columns.id] })`) beside a relation the other way — declare it as a `belongsTo`.

Neither failure shows up in SQL — a join correlates on the raw columns, so the query works
either way. What breaks is quieter: a `guid()` paired with a plain `uuid()` leaves
`article.authorId` raw while `article.author.id` comes back wrapped, so the two never compare
equal. The usual mistake is adding a relation to a node table and leaving the foreign key as
`uuid()`.

## Relations and row policies

A relation may join tables with and without [row policies](./policies.md) in either direction, and nothing about declaring it changes. What changes is what a client sees through it:

- **A target with policies is filtered.** Joining to it applies its select policies inside that level's lateral, on top of the join correlation. A parent whose children the policies hide comes back with an empty array.
- **A target without policies is not.** The correlation is the only condition.
- **Every level is its own decision.** A table with policies two levels down is filtered as much as one directly below the root.

Correlating _on_ the column a policy reads — `workspaces.id` to `invoices.workspaceId` — is common and works, but such a join is already narrowed by its correlation. It is the relations that correlate on something else, like an author or an owner, where the policy is the only thing keeping other rows out.

## What relations do not do

- **No foreign keys are emitted.** Relations are a runtime construct; the migration module ignores them. Declaring `belongsTo` does not create a `REFERENCES` clause. If you want referential integrity in the database, that is a schema feature tracked separately (see [DSQL capabilities](../internals/dsql-capabilities.md) — DSQL does support FKs now).
- **Joins are only allowed on declared relations.** Ad-hoc joins go through `$query` with the `sql` tag.

## Related

- [Schema](./schema.md)
- [Querying](./querying.md)
- [Polymorphic relations](./polymorphic-relations.md)
- [Row policies](./policies.md)
