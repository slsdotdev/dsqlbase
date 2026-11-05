---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`relations()` takes a union as its source. Every member then has the relation from its own column, so `relations(posts, { reactions: hasMany(reactions, { from: [posts.columns.id], to: [reactions.columns.postId] }) })` joins reactions from a photo, from a video, and from `dsql.posts` through its shared `join` or `select`. The target must be a table.

A belongs-to a union may omit its `discriminator`. The member is then the first, in declaration order, holding the key, computed when the query runs (`CASE WHEN EXISTS … END`, exported as `ComputedDiscriminator`). The foreign key of a relation declared on a union reads the same way, so `reaction.postId === reaction.post.id` holds with nothing stored to say which member. Each such read costs one key lookup per member per row.

Docs: docs/decisions/0020-column-references.md, docs/guide/polymorphic-relations.md, docs/guide/relations.md, docs/guide/global-ids.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, docs/internals/architecture.md
