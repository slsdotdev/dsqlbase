<div align="center">
  <h3><strong>dsqlbase</strong></h3>
  <p>Schema, query, and migration toolkit for AWS Aurora DSQL.</p>
  <p>
    <a href="https://www.npmjs.com/package/dsqlbase"><img src="https://img.shields.io/npm/v/dsqlbase.svg?style=flat-square" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/dsqlbase"><img src="https://img.shields.io/npm/dm/dsqlbase.svg?style=flat-square" alt="npm downloads" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/npm/l/dsqlbase.svg?style=flat-square" alt="license" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/dsqlbase.svg?style=flat-square&logo=node.js&logoColor=white" alt="node" /></a>
  </p>
</div>

---

> [!CAUTION]
> dsqlbase is in early-stage development and not suited for production environments.
> Features may change at any time, without prior notice.

## About

dsqlbase is a SQL query client and schema management toolkit built for [Aurora DSQL](https://aws.amazon.com/rds/aurora/dsql/) and its distributed feature set.

### Motivation

Aurora DSQL is a PostgreSQL-compatible, distributed relational database, and while the TypeScript ecosystem has some great solutions to interact with SQL databases, none of them, _at the moment of writing this_, offer out-of-the-box support for it, due to its [constraints](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with.html), like:

- **Immutable columns** - tables cannot drop columns and column constraints cannot be altered or dropped.
- **Async DDL operations** - DSQL runs DDL operations asynchronously, allowing for uninterrupted reads and writes.
- **One DDL statement per transaction** - transactions can contain only one DDL statement, and you can't mix DDL and DML statements.

Working against DSQL with popular Postgres ORMs feels hacky — they assume capabilities DSQL doesn't have, so you end up fighting the migration generator and keeping the distributed-database mental model in your head every time you write a relation or alter a column.

dsqlbase embraces those constraints as features while aiming to provide a seamless experience and declarative interface for its users.

## Showcase

### Install

```bash
npm install dsqlbase @aws/aurora-dsql-node-postgres-connector pg
npm install --save-dev @types/pg
```

### Schema and relations definition

```ts
import {
  table,
  uuid,
  text,
  varchar,
  boolean,
  datetime,
  relations,
  hasMany,
  belongsTo,
} from "dsqlbase/schema";

export const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", 100).notNull(),
  email: text("email").notNull().unique(),
  createdAt: datetime("created_at").notNull().defaultNow(),
});

export const tasks = table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  assigneeId: uuid("assignee_id").notNull(),
  title: text("title").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
});

tasks.index("tasks_assignee_idx").columns((c) => [c.assigneeId]);

export const userRelations = relations(users, {
  tasks: hasMany(tasks, {
    from: [users.columns.id],
    to: [tasks.columns.assigneeId],
  }),
});

export const taskRelations = relations(tasks, {
  assignee: belongsTo(users, {
    from: [tasks.columns.assigneeId],
    to: [users.columns.id],
  }),
});
```

### Query client

```ts
import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import { createPgSession } from "dsqlbase/pg";
import { createClient } from "dsqlbase";
import * as schema from "./schema";

const session = createPgSession(
  new AuroraDSQLPool({
    host: "<CLUSTER_ENDPOINT>",
  })
);

export const dsql = createClient({ schema, session });

// Use it
await dsql.users.create({
  data: { name: "Eve Adams", email: "eve@example.com" },
});

const user = await dsql.users.findOne({
  where: { email: { eq: "eve@example.com" } },
  select: { id: true, email: true },
  join: {
    tasks: true,
  },
});
```

## Migrations

> [!NOTE]
> The migration module is currently in active development and we do not yet provide a public interface for interacting with it.
> Examples of how to run migrations can be found in the [tests](./packages/tests/src/db/migrate.ts) package.

The current migration runner follows a five-step pipeline:

1. **Validate** — validate the schema definition.
2. **Introspect** — read the live database via `pg_catalog` queries.
3. **Reconcile** — diff the introspected snapshot against the in-code definition.
4. **Plan** — produce ordered DDL operations.
5. **Execute** — apply the plan as individual transactions, batching and awaiting async jobs.

This approach was chosen because we plan to support applying migrations as part of CloudFormation deployments via custom resources. We are working on a CDK construct to help with this.

That said, the pipeline is built around primitives for each step, so other migration strategies and a CLI utility are also planned.

## Inspiration & attribution

- [Drizzle ORM](https://orm.drizzle.team/) - The schema-definition ergonomics draw on drizzle's column-builder approach.
- [Prisma](https://www.prisma.io/) - The query-client interface was inspired by Prisma.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for issue and PR guidelines.

## License

MIT.
