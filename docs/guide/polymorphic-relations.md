# Polymorphic relations

_Audience: application developers._

A relation usually points at one table. A **polymorphic** relation points at a
[`union()`](./schema.md#unions) of tables: a feed that mixes photos and videos, or the items
of a folder that holds both files and other folders. The client reads it as one `UNION ALL`
over the members. Ordering, `limit` and `offset` run across all members in SQL, and each row
comes back shaped like the member it came from.

Source: `packages/dsqlbase/src/schema/union.ts`, `packages/core/src/runtime/query.ts`
(`_buildUnion`), `packages/core/src/runtime/operation.ts` (`_resolveUnionParams`).

## In GraphQL terms

| GraphQL                       | dsqlbase                                                            |
| ----------------------------- | ------------------------------------------------------------------- |
| `union Post = Photo \| Video` | `union({ photos, videos }, {})` — members keyed by schema alias     |
| `interface Post { id }`       | `union({ photos, videos }, { id: guid("id") })` — **shared fields** |
| `... on Photo { photoUrl }`   | `on: { photos: { select: { photoUrl: true } } }`                    |
| `__typename`                  | `$$key` (the member alias), or `$$meta.__typename` from `.meta()`   |

## Declaring one

```ts
export const photos = table("photos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  photoUrl: text("photo_url").notNull(),
}).meta({ __typename: "Photo" });

export const videos = table("videos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  videoUrl: text("video_url").notNull(),
}).meta({ __typename: "Video" });

export const posts = union(
  { photos, videos },
  {
    id: guid("id"),
    userId: guid("user_id").notNull(),
    createdAt: datetime("created_at").notNull(),
  }
);

export const userRelations = relations(users, {
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
  latestPost: hasOne(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
});
```

The second argument declares the **shared fields** — what `posts.columns` holds, and what
selects, filters and orders across the union. Each must be the same column on every member:
same field, database name, type and kind, and `NOT NULL` on every member if declared so
([Schema → Unions](./schema.md#unions)). A field on one member only is not declared; it is
reached through `on`.

See [Relations to a union](./relations.md#relations-to-a-union) for the per-member `to` form and
for the checks `createClient` runs.

## Joining one

```ts
const user = await dsql.users.findOne({
  where: { id: { eq: userId } },
  join: {
    feed: {
      select: { id: true, createdAt: true }, // shared fields, from every member
      where: { createdAt: { gt: since } }, // shared fields, applied inside every member
      orderBy: { createdAt: "desc" }, // across members
      limit: 20,
      on: {
        photos: { select: { photoUrl: true } }, // member-only additions
        videos: false, // leave a member out
      },
    },
  },
});

for (const post of user?.feed ?? []) {
  if (post.$$key === "photos") post.photoUrl; // narrowed to the photos row
}
```

- **The shared level** — `select`, `where`, `orderBy`, `limit`, `offset` — accepts the union's
  shared fields only, plus [`$$key`](#filtering-and-ordering-by-member) in `where` and `orderBy`. Every member runs it, each against its own columns. A field on one member
  only goes through `on`.
- **`on.<alias>`** is `true` (the default: the member runs with the shared arguments),
  `false` (the member produces no branch and leaves the result type), or an object that adds
  member-only arguments:
  - its `select` is merged with the shared one, and may name the member's relations, as on a
    table ([relations in `select`](./querying.md#relations-in-select));
  - its `where` is AND-ed with the shared one inside that member;
  - its `join` walks the member's own relations.
- **Omitting `select`** returns every column of each member, as it does for a table.
- **A relation to a union in `select`** (`select: { feed: { id: true } }`) takes the shared
  fields only, and reads as the same relation in `join`.
- **`distinct` is refused** on a union.
- **A has-many** yields an array, and **a has-one** yields one row or `null`. With every member
  excluded, the join adds no SQL at all, and the field is `[]` or `null`.
- **A belongs-to a union** joins only the member its discriminator names — see
  [below](#a-belongs-to-a-union).

## `$$key`: which member a row came from

Every row of a union carries a top-level **`$$key`**: the alias of the member it came from.
That is what narrows the result type. `$$meta.key` holds the same value, but TypeScript does not
narrow a union on a nested property, so `post.$$meta.key === "photos"` compiles and narrows
nothing. `$$meta` itself is the member's own, including anything `table().meta()` declared,
such as `__typename`. Ordinary single-table rows have no `$$key`.

### Filtering and ordering by member

`$$key` is also a pseudo-field in the shared `where` and `orderBy`, typed as the member aliases.
That is the way to turn a runtime value, such as a resolver's `type: VIDEO` argument, into a
filter:

```ts
await dsql.users.findOne({
  where: { id: { eq: userId } },
  join: { feed: { where: { $$key: { in: types } }, orderBy: { $$key: "asc", createdAt: "desc" } } },
});
```

- **Operators.** It accepts `eq`, `neq`, `in` and the bare-value shorthand, inside `and` / `or` /
  `not` too. A value that is not a member alias throws.
- **Never sent to SQL.** Within one member, `$$key` is a constant, so each condition is decided
  per member while the query is built:
  - a member that cannot match produces no branch;
  - a condition every member satisfies is dropped;
  - an `or` mixing `$$key` with other fields keeps only the conditions still open for that
    member.

  When no member is left, the join adds no SQL.

- **The result type does not change.** Its value is usually only known at runtime, so every
  member stays in the type. Use `on: { alias: false }` to remove a member from the query and
  the type both.
- **Ordering by `$$key`** sorts by member alias. Not naming it still uses it as the first
  tiebreaker.

### Filtering by global id

A shared `guid()` field is decided per member the same way when its value is a
[global id](./global-ids.md). Each member's `id` holds ids for that member only, so a photos id
cannot match a video:

```ts
const post = await dsql.posts.findOne({ where: { id: { eq: postId } } }); // reads one member
```

- `eq` with an id for another member produces no branch for that member, and `in` hands each
  member only the ids that name it.
- `neq` with an id for another member is true of every row of it that has a value.
- A field whose ids name one node on every member, such as `userId` above, keeps every branch.
  A raw uuid keeps every branch too, since it could be in any member.

## Ordering and pages

With an `orderBy`, rows are sorted by the shared fields first. Ties are then broken by `$$key`,
and after that by the primary key when every member's key has the same arity and types. That
makes the order total, so `limit` / `offset` pages never skip or repeat a row.

With a `limit`, each member is also ordered and limited to `limit + offset` rows before the
union combines them. This is always safe, because every member sorts by the same keys the
combined rows do.

## Tenancy

Each member's branch passes through the same `WHERE` seam as a table level, so a
[tenant-scoped](./tenancy.md) member is filtered inside its own branch, and a global member is
not. A union with a scoped member, reached from an enforcing client that carries no claims, is
refused with a `TenancyError`, exactly as a join to that member alone would be.

## A belongs-to a union

A row that points at one of several tables stores the pair a global id is made of: which
member, in a text **discriminator** column holding the member's alias, and which row, in the
`from` column. Declare the `from` column as a `guid()`:

```ts
export const ledgerEntries = table("ledger_entries", {
  id: guid("id").primaryKey().defaultRandom(),
  counterpartyType: text("counterparty_type"), // "companies" or "persons"
  counterpartyId: guid("counterparty_id"), // the discriminator names its node, row by row
  amount: numeric("amount").notNull(),
});

export const ledgerEntryRelations = relations(ledgerEntries, {
  counterparty: belongsTo(tradingEntities, {
    from: [ledgerEntries.columns.counterpartyId],
    to: [tradingEntities.columns.id],
    discriminator: ledgerEntries.columns.counterpartyType,
  }),
});
```

- **Joining.** Each member's branch also requires the discriminator to name that member, so
  two members holding the same key never both match. The join yields that member's row, or
  `null`.
- **Reading.** `counterpartyId` comes back wrapped with the member the row's discriminator
  names, so `entry.counterpartyId === entry.counterparty?.id` holds. Selecting only the id still
  reads the discriminator behind the scenes, without adding it to the result. A `NULL`
  discriminator leaves the id raw.
- **Writing.** A global id fills the discriminator:
  `create({ data: { counterpartyId: companyId } })` writes `counterparty_type = 'companies'`.
  Passing the discriminator too is fine when it agrees, and throws `GlobalIdError`
  (`key_mismatch`) when it does not, or when the id names a table outside the union. A raw uuid
  leaves the discriminator untouched.
- **Filtering.** A global id matches on both columns:
  - `{ counterpartyId: { eq: companyId } }` becomes
    `(counterparty_type = 'companies' AND counterparty_id = $1)`;
  - `neq` negates that pair;
  - `in` ORs one pair per id.

  A raw uuid compares the id alone.

- **Pairs must agree.** The `from` column must be a `guid()` and every member
  related through a single-column unique key of its own ([nodes](./global-ids.md#nodes)), or
  `from` and every member key must be plain `uuid()`. A mix throws when the client is built, as for any relation.
- **Reverse relations.** A member may declare a has-many back onto the polymorphic column, such
  as `companies.entries`. That relation correlates on the id alone; the discriminator is not
  applied to it.

### Without a discriminator

The discriminator is optional. Without one, the member is the first, in declaration order,
holding a row with the key. It is computed when the query runs:

```ts
export const reactionRelations = relations(reactions, {
  post: belongsTo(posts, { from: [reactions.columns.postId], to: [posts.columns.id] }),
});
```

```sql
CASE WHEN EXISTS (SELECT 1 FROM "photos" AS "__d0" WHERE "__d0"."id" = "__t0"."post_id")
     THEN 'photos'
     WHEN EXISTS (SELECT 1 FROM "videos" AS "__d1" WHERE "__d1"."id" = "__t0"."post_id")
     THEN 'videos' END AS "post_id$key"
```

- **Reading.** `postId` comes back wrapped with the member holding it, so
  `reaction.postId === reaction.post?.id` holds. A key no member holds reads raw.
- **Joining.** Each branch matches only the member the expression picks, so a key two members
  hold joins the first one, as the id reads.
- **Writing.** A member's global id is unwrapped to its key; there is nothing to fill.
- **Filtering.** `{ postId: { eq: photoId } }` matches the key, held by `photos`.
- **Cost.** One key lookup per member for every row read, whether or not the id is selected
  with its relation. It suits a few members; a stored discriminator costs nothing.
- **Tenancy.** The lookup only says which member holds a key the row already carries, so it
  reads the members without their tenant predicate. The join itself applies it, as always.

## Relations declared on a union

`relations()` also takes a union. Every member then has the relation from its own column, so
`posts` has many `reactions` means `photos` and `videos` each have many reactions:

```ts
export const postRelations = relations(posts, {
  reactions: hasMany(reactions, { from: [posts.columns.id], to: [reactions.columns.postId] }),
});

const feed = await dsql.posts.findMany({ join: { reactions: true } }); // or select: { reactions: true }
const photo = await dsql.photos.findOne({ where, select: { reactions: true } });
```

- `from` names the union's declared fields, and the target must be a table.
- The name must be free on every member.
- `reactions.postId` holds a key of whichever member the row points at, with nothing stored to
  say which. It reads as that member's id, computed as above, and the relation pairs with a
  belongs-to back to the union without a discriminator.
- A union's shared `join` and `select` take these relations; `on.<alias>.join` takes the
  member's own as well.

## Reading a union directly

Every union in the schema is also a read-only client under its own alias — `dsql.posts`, next
to `dsql.photos` and `dsql.videos` — for queries that start at the union rather than at a row
related to it, such as a top-level `partners: [Partner]` field. It takes the same shared-level
arguments and `on` map as a join. Source: `packages/dsqlbase/src/client/union/client.ts`.

```ts
const posts = await dsql.posts.findMany({
  where: { userId: { eq: userId }, $$key: { in: types } },
  orderBy: { createdAt: "desc" },
  limit: 20,
  on: { photos: { join: { owner: true } } },
});

const post = await dsql.posts.findOne({ where: { id: { eq: postId } } }); // where required
const total = await dsql.posts.count({ where: { userId: { eq: userId } } });
```

- **No writes.** A row is created, updated or deleted through its member's own model.
- **`count`** adds up one `count(*)` per member, each through its own `WHERE` seam.
- **`findOne` requires a `where`**, as it does on a table.

### Pages

`paginate` works as it does on a table ([Pagination](./pagination.md)), with cursors, `after` /
`before`, `limit` and `count: true`:

```ts
const page = await dsql.posts.paginate({
  where: { userId: { eq: userId } },
  orderBy: { createdAt: "desc" },
  limit: 20,
  after: previous?.endCursor,
});

page.items[0].$$meta.cursor;
```

- **Total order.** Pages are read under the `orderBy`, then `$$key`, then every primary-key
  column by position. The appended keys follow the direction of the last `orderBy` key, the
  same rule as a table.
- **Cursors.** A cursor is signed against the union's alias and that order, so a table's cursor
  never reads a union's page.
- **Where the keyset applies.** It is applied inside each member's branch, where `$$key` is a
  constant, so the per-member `limit` stays valid.
- **Aligned keys required.** Paging needs every member's primary key to have the same arity and
  column types, because the key is what breaks a tie between two members' rows. A union whose
  keys do not line up can still be read with `findMany` and `offset`, but `paginate` throws.

### Visibility

A union is visible on a client only when **every** member is. On an enforcing client with no
claims, a union with a [tenant-scoped](./tenancy.md) member is absent from the type, just as
the member is, and it refuses at runtime too. On the client `$identityClaims` returns, or on the
transaction client inside one, it is present again.

## Limits

- No foreign key can be emitted for a union target, and a polymorphic `from` column cannot
  carry one in the database; relations emit none anyway.
- Only declared shared fields filter, select or order across a union; only relations declared
  on the union join across it.
- `paginate` needs members whose primary keys line up.

## Related

- [Relations](./relations.md)
- [Schema](./schema.md#unions)
- [Querying](./querying.md)
- [Pagination](./pagination.md)
- [Global ids](./global-ids.md)
