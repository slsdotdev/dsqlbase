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

| GraphQL                       | dsqlbase                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| `union Post = Photo \| Video` | `union({ photos, videos })` — members keyed by schema alias       |
| `interface Post { id }`       | the same `union()`; the interface's fields are **shared fields**  |
| `... on Photo { photoUrl }`   | `on: { photos: { select: { photoUrl: true } } }`                  |
| `__typename`                  | `$$key` (the member alias), or `$$meta.__typename` from `.meta()` |

## Declaring one

```ts
export const photos = table("photos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id", "users").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  photoUrl: text("photo_url").notNull(),
}).meta({ __typename: "Photo" });

export const videos = table("videos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id", "users").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
  videoUrl: text("video_url").notNull(),
}).meta({ __typename: "Video" });

export const posts = union({ photos, videos }); // shared: id, userId, createdAt

export const userRelations = relations(users, {
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
  latestPost: hasOne(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
});
```

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
  shared fields only. Every member runs it, each against its own columns. A field on one member
  only goes through `on`.
- **`on.<alias>`** is `true` (the default: the member runs with the shared arguments),
  `false` (the member produces no branch and leaves the result type), or an object that adds
  member-only arguments:
  - its `select` is merged with the shared one;
  - its `where` is AND-ed with the shared one inside that member;
  - its `join` walks the member's own relations.
- **Omitting `select`** returns every column of each member, as it does for a table.
- **`distinct` is refused** on a union.
- **A has-many** yields an array, and **a has-one** yields one row or `null`. With every member
  excluded, the join adds no SQL at all, and the field is `[]` or `null`.
- **A belongs-to a union** can be declared, but joining it is refused until its discriminator is
  applied per member.

## `$$key`: which member a row came from

Every row of a union carries a top-level **`$$key`**: the alias of the member it came from.
That is what narrows the result type. `$$meta.key` holds the same value, but TypeScript does not
narrow a union on a nested property, so `post.$$meta.key === "photos"` compiles and narrows
nothing. `$$meta` itself is the member's own, including anything `table().meta()` declared,
such as `__typename`. Ordinary single-table rows have no `$$key`.

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

## Limits

- No foreign key can be emitted for a union target; relations emit none anyway.
- Only shared fields filter, select or order across a union.

## Related

- [Relations](./relations.md)
- [Schema](./schema.md#unions)
- [Querying](./querying.md)
- [Global ids](./global-ids.md) — the same `on` map
