---
"dsqlbase": minor
---

Global ids: an id that names its table as well as its row.

- **`guid(name, key?)`** (from `dsqlbase/schema`) is a `uuid` column whose values read back as `guid:<base64url>`. A table whose primary key is exactly one `guid()` column is a **node**, keyed by its schema alias. The second argument names the node a column points at — `guid("author_id", "authors")` makes `article.authorId` and `article.author.id` the same string. It serializes exactly as `uuid()`, so adopting it on an existing column changes no DDL.
- **Wrapped ids and raw uuids are both accepted** wherever the column is. An id naming another node throws `GlobalIdError("key_mismatch")` when the query is built.
- **`dsql.$findByGlobalId({ id, on? })`** reads the row an id names, or `null`. **`dsql.$listByGlobalId({ ids, on? })`** reads many — one query per table — in the order given, with `null` for a miss. Both go through the table's model client, so they carry the tenant predicate. Their rows carry a top-level `$$key` naming the node, which narrows the result type.
- `encodeGlobalId`, `decodeGlobalId`, `isGlobalId` and `GlobalIdError` are exported from the package root.

**Breaking:** `$$meta.key` is typed as the literal schema alias rather than `string`. Three schemas that used to build now throw when the client is created: two tables claiming one node key, a `guid()` column naming no node, and a relation whose two sides disagree about global ids.

Docs: docs/guide/global-ids.md, docs/guide/schema.md, docs/guide/relations.md, docs/decisions/0007-global-ids.md
