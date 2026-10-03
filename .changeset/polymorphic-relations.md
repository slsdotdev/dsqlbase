---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Polymorphic relations: `union()` of tables, relations to it, and reading it directly.

- **`union({ photos, videos })`** (from `dsqlbase/schema`) declares tables that can stand in for one another. `union.columns` holds their shared fields — those every member declares with the same type. A union produces no DDL.
- **Relations to a union.** `hasMany`, `hasOne` and `belongsTo` accept one. A join to it takes shared-field `select`, `where`, `orderBy`, `limit` and `offset`, applied to every member, plus a per-member `on: { alias: true | false | { select, where, join } }` — GraphQL's fragments. It runs as one `UNION ALL`, ordered and limited across all members in SQL.
- **`$$key`** on every union row names its member and narrows the result type. In a `where` it filters by member (`{ $$key: { in: types } }`), decided while the query is built, so a member that can't match adds no SQL; `orderBy: { $$key: "asc" }` sorts by it.
- **`belongsTo(union, { from, to, discriminator })`** joins the member the row's discriminator names. Its `from` column is a keyless `guid()`, which reads, writes and filters global ids keyed by that discriminator.
- **`dsql.<unionAlias>`** reads a union directly: `findOne`, `findMany`, `paginate` (cursors over `orderBy`, `$$key` and the primary key) and `count`. It is read-only; rows are written through their member's model.
- Every member passes the tenant predicate in its own branch. A union is on a client only when every member is.
- Relations to a union are validated when the client is created: members, column pairs, `to` lists, discriminators and global-id agreement.

**Breaking,** for `@dsqlbase/core` callers: a relation's `target` may be a union (`SchemaRegistry.getRelationTarget` returns `AnyTable | Union`), and `JoinParams` is `TableJoinParams | UnionJoinParams`. In `dsqlbase`, the `on` map of `$findByGlobalId` and `$listByGlobalId` takes `{ select, where, join }`.

Docs: docs/guide/polymorphic-relations.md, docs/guide/relations.md, docs/guide/querying.md, docs/decisions/0009-polymorphic-relations.md
