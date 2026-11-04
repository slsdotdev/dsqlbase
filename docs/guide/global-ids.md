# Global ids

_Audience: application developers._

A `uuid` says which row. It does not say which **table** — and once an id leaves the ORM, that
is the half that matters. An API that exposes `node(id)` has to get back to the row from the id
alone; a resolver handed an `ID` has no way to tell a `users` id from a `workspaces` one, since
both are well-formed uuids. Filtering by the wrong one returns nothing, silently.

`guid()` makes the table part of the value:

```ts
import { guid, table, text, relations, belongsTo } from "dsqlbase/schema";

export const authors = table("authors", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const articles = table("articles", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("author_id").notNull(),
  title: text("title").notNull(),
});

export const articleRelations = relations(articles, {
  author: belongsTo(authors, {
    from: [articles.columns.authorId],
    to: [authors.columns.id],
  }),
});
```

```ts
const article = await dsql.articles.findOne({
  where: { id: { eq: idFromClient } },
  join: { author: true },
});

article?.id; // "guid:WyJhcnRpY2xlcyIs…"
article?.author?.id; // "guid:WyJhdXRob3JzIiw…" — its own table
article?.authorId === article?.author?.id; // true
```

The database still holds plain uuids. Nothing about this reaches a migration: a `guid()` column
serializes exactly as `uuid()`, so switching an existing column over produces no DDL.

## Nodes

A table is a **node** — addressable by id — when it has a **unique key**: its primary key, of
any arity, a `.unique()` column, a `table.unique(...)` constraint, or a unique index over plain
columns. An id names a node by its **schema alias** — the key it is exported under, which is how
the client addresses it:

```ts
export const revisions = table("article_revisions", { id: guid("id").primaryKey() /* … */ });
// dsql.revisions  →  node key "revisions", not "article_revisions"
```

So ids follow the identity your callers see. Renaming the database table does not invalidate
ids already handed out; re-keying the schema object does.

An id resolves only when its payload's fields are **exactly one** of the table's unique keys, so
one id names at most one row:

```ts
encodeGlobalId("articles", { id }); // the primary key
encodeGlobalId("articleTags", { articleId, tagId }); // a composite key: both fields
encodeGlobalId("tags", { label: "news" }); // a unique column
encodeGlobalId("articleTags", { articleId }); // ✗ part of a key: GlobalIdError("key_mismatch")
```

Only `guid()` columns _emit_ ids. A table keyed by a plain `uuid()`, or by a composite key, is
still addressable, but its rows hand out no id of their own; build one with `encodeGlobalId`. A
table whose guid key is also a relation key — a profile sharing its user's id — emits its
user's id, and is addressable by `["profiles", { userId }]` built by hand.

Not keys: a partial unique index (unique only where its predicate holds), an expression index
(no payload field names an expression), and a nullable unique column's `NULL`s (a payload cannot
carry `null`). A table with none of the above is not a node.

## What a column's ids name

`guid()` takes only a column name. What its values name is worked out from the relations when
the client is built, in this order:

1. **The `from` of a belongs-to a union** names whichever member its discriminator says, row by
   row — see [below](#a-column-that-points-at-one-of-several-nodes).
2. **A relation key column** names the column it is paired with: the `from` of a `belongsTo`, or
   the `to` of a `hasMany` / `hasOne`. `articles.authorId` above reads as an authors id because
   `articles.author` pairs it with `authors.id`. A self reference works the same way, through
   its own relation.
3. **Any other column** names its own table and field. A primary key is the table's node id; an
   unrelated `photos.ownerId` reads as a photos id carrying `ownerId`, which is a stable,
   self-describing value. It is the address of a photo only if `ownerId` is unique; otherwise
   `$findByGlobalId` refuses it.

Rule 2 is what makes `article.authorId === article.author.id` hold without the application
unwrapping either side. Since the target comes from the relation, it cannot drift from it.
Adding a relation to a column that had none changes what its ids name; treat it as the schema
change it is.

Both sides of a relation pair must be `guid()` columns, or neither. A `guid()` paired with a
plain `uuid()` throws when the client is built, and so does a column that two relations pair
with different targets. Neither would break the SQL — a join correlates on the raw columns —
which is exactly why it is caught early.

### A column that points at one of several nodes

The `from` column of a [belongs-to a union](./polymorphic-relations.md#a-belongs-to-a-union) is
a `guid()` whose node is named row by row by the relation's discriminator. It reads back wrapped
with that member's key, a raw uuid when the discriminator is `NULL`. It accepts an id for any
member of the union on writes and filters, and throws `key_mismatch` for any other.

## Reading and writing

A wrapped id is accepted anywhere the column is, and so is a raw uuid — ids reach an
application from places that never went through the ORM:

```ts
await dsql.articles.findOne({ where: { id: { eq: "guid:WyJhcnRpY2xlcyIs…" } } }); // ✓
await dsql.articles.findOne({ where: { id: { eq: "3f1c0e3e-…" } } }); // ✓ raw
await dsql.articles.create({ data: { authorId: someAuthorId, title: "…" } }); // ✓ either
```

An id naming the **wrong** node throws `GlobalIdError` with `code: "key_mismatch"`, when the
query is built rather than when it runs. That is the safety net a bare uuid cannot provide: the
same mistake with plain uuids is a query that quietly matches nothing.

## Looking a row up

```ts
import { decodeGlobalId, encodeGlobalId, isGlobalId, GlobalIdError } from "dsqlbase";

const record = await dsql.$findByGlobalId(id);

if (record?.$$key === "authors") record.name;
if (record?.$$key === "articles") record.title;
```

`$findByGlobalId(id)` returns the row with every column, or `null` if it no longer exists. The
result is a union over every node in the schema, and **`$$key` is what narrows it** — the
literal alias, on the row itself. `$$meta.key` carries the same value, but TypeScript does not narrow a union
on a nested property, so `record.$$meta.key === "authors"` compiles and narrows nothing.

Neither lookup takes anything else. A narrower read — some columns, a join, an extra filter — is
the table's own `findOne` or `findMany`, which accept the same ids:

```ts
const { key } = decodeGlobalId(id);

if (key === "authors") {
  await dsql.authors.findOne({ where: { id: { eq: id } }, select: { name: true } });
}
```

`$listByGlobalId(ids)` resolves many at once — one query per table rather than one per id — and
returns them **in the order you asked**, each with every column, and `null` wherever a row is
missing. That is the shape a batch resolver wants:

```ts
const [a, b, c] = await dsql.$listByGlobalId([id1, id2, id3]); // [{ … }, null, { … }] if id2 is gone
```

A row is matched back to its id by node and key, not by the id's text: an id whose uuid is
spelled differently — upper case, braces, no hyphens — resolves here as it does in
`$findByGlobalId`.

## Tenancy

Both lookups go through the table's own model client, so a node lookup carries the tenant
predicate like any other read. On a client scoped with `$identityClaims`, another tenant's id
resolves to `null` — the row exists, it is simply not visible — and on a client with no claims a
tenant-scoped node throws `TenancyError`. See [Tenancy](./tenancy.md).

## Failure modes

| Input                                                       | Behaviour                                                |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| Raw uuid to a guid column                                   | accepted                                                 |
| Malformed `guid:` string                                    | `GlobalIdError("format")`                                |
| Wrapped id naming another node                              | `GlobalIdError("key_mismatch")`, when the query is built |
| Lookup fields that are not one of the table's unique keys   | `GlobalIdError("key_mismatch")`                          |
| A lookup for a table not in the schema, or with no key      | `GlobalIdError("unknown_node")`                          |
| `$findByGlobalId` for a row that is gone                    | `null`                                                   |
| `$listByGlobalId` with one unusable id                      | throws; a missing _row_ is a `null` in place             |
| A relation pairing a guid with a uuid                       | throws when the client is built                          |
| A column two relations pair with different targets          | throws when the client is built                          |
| `$query` with a wrapped id                                  | **not** unwrapped — see below                            |

## Raw SQL

`$query` and `$execute` are raw by design, so nothing unwraps an id for them. Use the column's
own `param`, which runs the codec:

```ts
await dsql.$query(sql`
  select * from "articles" where ${articles.columns.id} = ${articles.columns.id.param(id)}
`);
```

Or decode it yourself:

```ts
const { key, pk } = decodeGlobalId(id); // { key: "articles", pk: { id: "3f1c0e3e-…" } }
```

## The format

`guid:` followed by base64url of `[tableKey, { [keyField]: value, … }]`. Treat it as opaque — the
helpers are the contract, not the encoding — but two properties are worth knowing:

- **The prefix makes "is this wrapped?" exact**, since a uuid never starts with `guid:`. That is
  what lets a column accept both forms without guessing.
- **The payload names its key fields** rather than assuming `id`, so a node keyed `membershipId`
  works, and a composite key is one object with every field of it.

Both the table key and the field names are **aliases** — the names the client uses — so an id
follows your API's identity rather than the physical schema.

## Related

- [Schema](./schema.md) — `guid()` beside the other column builders
- [Relations](./relations.md) — the guid pair rule
- [Querying](./querying.md) — `$$meta` on every row
- [Tenancy](./tenancy.md) — a node lookup is scoped like any other read
- [Codec boundary](../internals/codec-boundary.md) — where the wrapping runs
