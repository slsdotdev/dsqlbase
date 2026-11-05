---
"dsqlbase": minor
"@dsqlbase/core": minor
---

`union(members, columns)` declares its shared fields: `union({ photos, videos }, { id: guid("id"), userId: guid("user_id") })`. Each field resolves to the member column under the same field, which must have the same database name, type and kind, and be `NOT NULL` on every member when declared so. Declaring a field some member lacks is a type error. `union.columns`, shared `select` / `where` / `orderBy`, and a relation's `to` list take only declared fields.

A global id on a shared field now selects its own member: `posts.findOne({ where: { id: { eq: photoId } } })` reads photos only, instead of throwing `key_mismatch` from the other members. `in` splits its ids by member, and `neq` with another member's id matches that member's rows that have a value.

**Breaking:**

- `union()` requires its columns;
- a field stored under different column names is no longer shared — use the per-member `to` map;
- `SharedFieldsOf` is replaced by `CommonFieldsOf` / `UnionColumnsConfig`;
- the client's union types (`UnionQueryArgs`, `UnionResultOf`, `UnionClient`, …) take the union definition instead of its members.

Docs: docs/decisions/0019-declared-union-columns.md, docs/guide/schema.md, docs/guide/polymorphic-relations.md, docs/guide/relations.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md, packages/dsqlbase/README.md
