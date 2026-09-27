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

## Links

- [Guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/README.md) — schema, querying, sessions, transactions, tenancy, global ids, migrations, DSQL notes
- [Repository](https://github.com/slsdotdev/dsqlbase)
- [Issues](https://github.com/slsdotdev/dsqlbase/issues)
- [Contributing](https://github.com/slsdotdev/dsqlbase/blob/main/CONTRIBUTING.md)

## License

MIT.
