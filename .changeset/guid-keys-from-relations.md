---
"dsqlbase": minor
---

`guid()` takes only a column name. What a column's ids name comes from the relations, resolved when the client is built:
- the key side of a relation pair — the `from` of a `belongsTo`, the `to` of a `hasMany` / `hasOne` — names the column it is paired with;
- the `from` of a discriminated `belongsTo` names its discriminator's member, row by row;
- any other column names its own table and field.

`createClient` throws for a column that two relations pair with different targets, and for columns that reference each other in a ring.

**Breaking:**
- the second argument of `guid()` is removed;
- a node's key is always its schema alias;
- a non-key guid column with no relation reads as its own table and field rather than its table's primary key, so a self reference needs its relation;
- a primary key that is also a `belongsTo` key is no longer a node.

Docs: docs/decisions/0018-guid-keys-from-relations.md, docs/guide/global-ids.md, docs/guide/schema.md, docs/guide/relations.md, docs/guide/polymorphic-relations.md, docs/internals/codec-boundary.md, packages/dsqlbase/README.md
