---
"dsqlbase": minor
---

Join a relation to a `union()`: one `UNION ALL` over its members, ordered and limited across all of them in SQL.

**Using it.** A has-many or has-one relation to a union takes shared-level `select`, `where`,
`orderBy`, `limit` and `offset`, which accept only the union's shared fields and apply to every
member through that member's own columns. On top of that, `on: { [memberAlias]: true | false | {
select, where, join } }` gives GraphQL's per-member fragment: `false` drops the member, and an
object merges a member-only `select`, ANDs a member-only `where`, and joins the member's own
relations.

**Reading it.** Every union row carries a top-level `$$key` with the member alias, which is what
narrows the result type (`UnionResultOf`). `$$meta` is the member's own. Ordered results break ties
by `$$key` and then by the primary key, when every member's key lines up. With a `limit`, each
member is also limited to `limit + offset` rows. With every member excluded, the join adds no
SQL and yields `[]` or `null`. `distinct` and non-shared fields are refused. Joining a
belongs-to a union is refused until its discriminator is applied.

**Every member passes the `WHERE` seam**, so a tenant-scoped member is filtered inside its own
branch and a claimless enforcing client is refused, just as for a table.

**The `on` map widens** to `select`, `where` and `join` everywhere it is accepted.
`$findByGlobalId` and `$listByGlobalId` forward them too. A lookup's `where` is ANDed with the id,
so a row that fails it reads as a miss.

**Breaking.** Changes in `@dsqlbase/core`:

- `JoinParams` is now `TableJoinParams | UnionJoinParams`, and `SelectOperationArgs.join` entries may carry `UnionSelectOperationArgs`.
- `FieldResolver` may hold a `UnionResolver`.
- `Column` gains `dataType`, `sql` gains `literal()`, and the new constant `KEY_FIELD` is exported.

In `dsqlbase`, `OnSelectionOf` entries widen from `{ select }` to `{ select, where, join }`.

Docs: docs/guide/polymorphic-relations.md (new), docs/guide/relations.md, docs/guide/querying.md, docs/guide/global-ids.md, docs/guide/README.md, docs/internals/runtime-pipeline.md
