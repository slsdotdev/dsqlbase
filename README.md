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

- **Async DDL operations** - DSQL runs index builds and constraint validation asynchronously, allowing for uninterrupted reads and writes.
- **One DDL statement per transaction** - transactions can contain only one DDL statement, and you can't mix DDL and DML statements.
- **Restricted `ALTER TABLE`** - columns can be added and dropped but not retyped or made `NOT NULL`; constraints are added `NOT VALID` and validated asynchronously; primary keys cannot be added after creation.
- **Optimistic concurrency** - no locks; conflicting transactions fail and must be retried.

Working against DSQL with popular Postgres ORMs feels hacky — they assume capabilities DSQL doesn't have, so you end up fighting the migration generator and keeping the distributed-database mental model in your head every time you write a relation or alter a column.

dsqlbase embraces those constraints as features while aiming to provide a seamless experience and declarative interface for its users.

## Documentation

Full documentation lives in [`docs/`](./docs/README.md):

- [Guide](./docs/guide/README.md) — install, schema, relations, querying, sessions, transactions, migrations, and [what DSQL changes](./docs/guide/dsql-notes.md).
- [Internals](./docs/internals/README.md) — architecture, runtime and migration pipelines, the verified [DSQL capability table](./docs/internals/dsql-capabilities.md).
- [Decisions](./docs/decisions/README.md) — accepted design records.

## Showcase

A taste of the API; the [guide](./docs/guide/README.md) covers each piece in depth.

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

The migration runner (`@dsqlbase/migration`) is declarative: validate the definition, introspect the live database, reconcile the two into ordered DDL operations, and execute them one statement per transaction while awaiting DSQL's async jobs. Changes DSQL cannot express come back as structured refusals rather than broken SQL.

See the [migrations guide](./docs/guide/migrations.md) for the runner surface and options. A CDK construct for applying migrations from CloudFormation deployments and a CLI are planned.

## Inspiration & attribution

- [Drizzle ORM](https://orm.drizzle.team/) - The schema-definition ergonomics draw on drizzle's column-builder approach.
- [Prisma](https://www.prisma.io/) - The query-client interface was inspired by Prisma.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for issue and PR guidelines.

## License

MIT.
