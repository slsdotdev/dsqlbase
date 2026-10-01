<div align="center">
  <h3><strong>dsqlbase</strong></h3>
  <p>Schema, query, and migration toolkit for AWS Aurora DSQL.</p>
</div>

---

> [!CAUTION]
> dsqlbase is in early-stage development and not suited for production environments.
> Features may change at any time, without prior notice.

dsqlbase is an ORM and migration toolkit purpose-built for [Aurora DSQL](https://aws.amazon.com/rds/aurora/dsql/). It treats DSQL's distributed-database constraints (async DDL, one DDL statement per transaction, restricted `ALTER TABLE`, optimistic concurrency) as first-class — refusing unsupported DDL up front and emitting DSQL-shaped SQL by default. See the [documentation](https://github.com/slsdotdev/dsqlbase/blob/main/docs/README.md) for the full guide.

## Install

```bash
npm install dsqlbase
```

## Quickstart

```ts
// schema.ts
import { table, uuid, text, datetime, relations, hasMany, belongsTo } from "dsqlbase/schema";

export const teams = table("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
});

export const projects = table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull(),
  name: text("name").notNull(),
});

export const teamRelations = relations(teams, {
  projects: hasMany(projects, {
    from: [teams.columns.id],
    to: [projects.columns.teamId],
  }),
});

export const projectRelations = relations(projects, {
  team: belongsTo(teams, {
    from: [projects.columns.teamId],
    to: [teams.columns.id],
  }),
});
```

```ts
// client.ts
import { Pool } from "pg";
import { createPgSession } from "dsqlbase/pg";
import { createClient, type Session, type SQLStatement } from "dsqlbase";
import * as schema from "./schema";

const session = createPgSession(
  new Pool({
    connectionString: process.env.DATABASE_URL,
  })
);

export const dsql = createClient({ schema, session });

// Use it
const recent = await dsql.projects.findMany({
  orderBy: { name: "asc" },
  limit: 10,
  join: { team: true },
});

// A relation can be selected like a field; filters, order and limits on it go in `join`
const withTeams = await dsql.projects.findMany({ select: { name: true, team: { name: true } } });
const withProjects = await dsql.teams.findMany({
  select: { name: true },
  join: { projects: { orderBy: { name: "asc" }, limit: 5 } },
});
```

## Multi-tenant schemas

If rows belong to a workspace, organisation or account, declare that boundary once and let the
client apply it. Aurora DSQL has no row-level security, so this is the layer that enforces it.

```ts
import { tenantScope, uuid } from "dsqlbase/schema";

const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });

export const invoices = ws.table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});

// Per request:
const db = dsql.$identityClaims({ workspaceId: claims.workspace_id });

await db.invoices.findMany({});                            // … WHERE "workspace_id" = $1
await db.invoices.create({ data: { number: "INV-1" } });   // workspace_id filled from the claim
```

The claim column is readable and filterable but never writable, the predicate applies to nested
joins as well as root queries, and a tenant table is absent from an unscoped client — in the
types and at runtime. See the [tenancy guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/tenancy.md).

## Global ids

If ids leave your process — a GraphQL `Node`, a webhook, a cursor — a bare `uuid` says which row
but not which table, so nothing can resolve one back or catch it being used against the wrong
table. `guid()` puts the table in the value:

```ts
import { guid, table, text } from "dsqlbase/schema";

export const authors = table("authors", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const articles = table("articles", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("author_id", "authors").notNull(),   // points at the authors node
});
```

```ts
const article = await dsql.articles.findOne({ where: { id }, join: { author: true } });

article?.id;                                 // "guid:WyJhcnRpY2xlcyIs…"
article?.authorId === article?.author?.id;   // true

const record = await dsql.$findByGlobalId({ id });
if (record?.$$key === "articles") record.title;
```

A raw uuid is still accepted on input; an id from another table throws rather than quietly
matching nothing. It serializes as a plain `uuid`, so adopting it produces no migration. See the
[global ids guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/global-ids.md).

## Pagination

`paginate` reads one page at a time from a cursor rather than an offset, ordered by your
`orderBy` and then the primary key, so no row is skipped or repeated between pages:

```ts
const page = await dsql.tasks.paginate({
  where: { status: "todo" },
  orderBy: { createdAt: "desc" },
  limit: 20,
  after: previous?.endCursor,
  count: true,                     // adds totalCount
});

page.items;        // each with $$meta.cursor
page.hasNextPage;
page.endCursor;

const open = await dsql.tasks.count({ where: { status: "todo" } });
```

See the [pagination guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/pagination.md).

## JSON columns

`jsonb()` holds any JSON value. `.schema()` takes any [Standard Schema](https://standardschema.dev)
— zod, valibot, arktype, none of them a dependency — and validates every write and every read:

```ts
import { z } from "zod";
import { jsonb } from "dsqlbase/schema";

const Settings = z.object({
  theme: z.enum(["light", "dark"]).default("light"),
  since: z.coerce.date(),
});

export const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  settings: jsonb("settings").schema(Settings),
});

await dsql.users.create({ data: { settings: { since: "2026-10-01" } } });
// stored: {"theme":"light","since":"2026-10-01T00:00:00.000Z"}
// read:   { theme: "light", since: Date }
```

A write stores the schema's output — defaults filled — and checks it reads back as itself, so a
transforming schema is refused on its first write. Filters, order and operators follow each
column's type: a `json` column filters by `exists`, and a `jsonb` column also by `eq`, `neq` and
`contains` — a fragment of the document, matched with `@>`. See the
[schema guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/schema.md#json-columns).

## Polymorphic relations

`union()` groups tables that stand in for one another — a GraphQL union or interface — and
relations can point at it. The client reads it as one `UNION ALL`, ordered and limited across
members in SQL, and `$$key` on every row says which member it came from:

```ts
import { union, relations, hasMany } from "dsqlbase/schema";

export const posts = union({ photos, videos });

export const authorRelations = relations(authors, {
  posts: hasMany(posts, { from: [authors.columns.id], to: [posts.columns.authorId] }),
});

const author = await dsql.authors.findOne({
  where: { id: { eq: authorId } },
  join: {
    posts: {
      orderBy: { createdAt: "desc" },
      limit: 20,
      on: { photos: { select: { photoUrl: true } } }, // per-member fragment
    },
  },
});

for (const post of author?.posts ?? []) {
  if (post.$$key === "photos") post.photoUrl;
}

const page = await dsql.posts.paginate({ where: { $$key: { in: types } }, limit: 20 });
```

A `belongsTo(union, { ..., discriminator })` points one row at one of several tables. Its
`guid()` reads back keyed by whichever member the discriminator names. See the
[polymorphic relations guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/polymorphic-relations.md).

## Links

- [Guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/README.md) — schema, querying, pagination, polymorphic relations, sessions, transactions, tenancy, global ids, migrations, DSQL notes
- [Repository](https://github.com/slsdotdev/dsqlbase)
- [Issues](https://github.com/slsdotdev/dsqlbase/issues)
- [Contributing](https://github.com/slsdotdev/dsqlbase/blob/main/CONTRIBUTING.md)

## License

MIT.
