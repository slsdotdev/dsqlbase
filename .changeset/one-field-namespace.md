---
"dsqlbase": minor
---

Reject a relation that shares a name with a column on the same table.

Columns and relations are one field namespace: `select`, `join` and the keys of a result row all address them as fields of the same model, so a name can only mean one of them. Nothing checked this before, and `QueryResultOf` would intersect the column's type with the joined row's.

`createClient` now throws, naming both:

```
Relation "author" on table "articles" collides with a column of the same name.
Columns and relations share one field namespace on a table.
```

Breaking: a schema with a colliding relation name now fails at `createClient`.

Docs: docs/guide/relations.md, docs/guide/schema.md, docs/internals/runtime-pipeline.md
