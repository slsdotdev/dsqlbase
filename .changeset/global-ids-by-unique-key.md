---
"dsqlbase": minor
---

Global ids resolve by any unique key. `$findByGlobalId` / `$listByGlobalId` accept an id whose fields are exactly one of the table's unique keys: its primary key of any arity, a `.unique()` column, a `table.unique(...)` constraint, or a non-partial unique index over plain columns. A composite key is one id carrying every field: `encodeGlobalId("articleTags", { articleId, tagId })`. A uuid-keyed table is addressable the same way. Only `guid()` columns emit ids; other keys are built with `encodeGlobalId`.

**Breaking:**
- An id whose fields are not a unique key (part of a composite key, or a non-unique column) throws `GlobalIdError("key_mismatch")` with a new message.
- `unknown_node` now means the table is not in the schema or has no unique key.
- `NodeTable` (from `getNodes`) carries `keys: string[][]` in place of `keyField` / `keyColumn`.
- `NodeAliasesOf` is every table alias, so a lookup's result union covers every table. `NodeKeyFieldOf` is removed.
- A polymorphic `belongsTo` member must be related through a single-column unique key of its own, rather than a guid primary key.

Docs: docs/guide/global-ids.md, docs/guide/schema.md, docs/guide/polymorphic-relations.md, docs/internals/architecture.md, docs/internals/runtime-pipeline.md, docs/decisions/0007-global-ids.md, docs/decisions/0018-guid-keys-from-relations.md
