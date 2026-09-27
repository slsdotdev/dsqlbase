---
"dsqlbase": minor
---

Give a row an id that says which table it came from.

A `uuid` identifies a row but not a table, so once an id leaves the ORM nothing can resolve it
back, and nothing catches it being used against the wrong table — the same mistake with plain
uuids is a query that quietly matches nothing.

**Declaring it.** `guid(name, key?)` (from `dsqlbase/schema`) is a `uuid` column whose values
read back as `guid:<base64url>`, naming both the row and its table. A table whose primary key is
exactly one `guid()` column is a **node**, keyed by its schema alias — the name the client
addresses it by, so ids follow your API's identity rather than the physical schema. The optional
second argument names the node a column *points at*: `guid("author_id", "authors")` makes
`article.authorId` and `article.author.id` the same string. It serializes exactly as `uuid()`,
so adopting it on an existing column produces no DDL.

**Using it.** Wrapped ids are accepted anywhere the column is, and so are raw uuids — ids reach
an application from places that never went through the ORM. An id naming another node throws
`GlobalIdError("key_mismatch")` when the query is built.

**Resolving it.** `dsql.$findByGlobalId({ id, on? })` reads the row an id names, or `null`.
`dsql.$listByGlobalId({ ids, on? })` reads many — one query per table rather than one per id —
in the order you asked, with `null` for misses. Both exist on a scoped client and inside a
transaction, and both go through the table's own model client, so a node lookup carries the
tenant predicate like any other read rather than routing around it.

`encodeGlobalId`, `decodeGlobalId`, `isGlobalId` and `GlobalIdError` are exported from the
package root, for raw SQL and for code that never touches a model.

**`$$key` is the discriminant, not `$$meta.key`.** The result of a lookup is a union over every
node, and TypeScript does not narrow a union on a nested property — `record.$$meta.key === "x"`
compiles and narrows nothing. Those rows carry a top-level `$$key` with the literal alias; rows
from a model method do not, since a single-table read has nothing to discriminate.

**Breaking.** `$$meta.key` is now typed as the literal schema alias rather than `string` on
every result row, so a test asserting `key: string` needs updating. Three schemas that used to
build now throw: two tables claiming one node key, a `guid()` column naming no node, and a
relation pair whose columns disagree about global ids — both sides must be `guid()` columns
naming the same node, or neither. `@dsqlbase/core` is unchanged: nothing below the client has an
opinion about the shape of an id.

Docs: docs/guide/global-ids.md, docs/guide/schema.md, docs/guide/relations.md, docs/guide/querying.md, docs/guide/tenancy.md, docs/guide/README.md, docs/internals/codec-boundary.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md, docs/decisions/0007-global-ids.md, docs/decisions/README.md, README.md, packages/dsqlbase/README.md
