<div align="center">
  <h3><strong>dsqlbase</strong></h3>
  <p>Schema, query, and migration toolkit for AWS Aurora DSQL.</p>
</div>

---

> [!CAUTION]
> dsqlbase is in early-stage development and not suited for production environments.
> Features may change at any time, without prior notice.

dsqlbase is an ORM and migration toolkit purpose-built for [Aurora DSQL](https://aws.amazon.com/rds/aurora/dsql/). It treats DSQL's distributed-database constraints (no foreign keys, no in-place column changes, async-only index builds, etc.) as first-class — refusing unsupported DDL up front and emitting DSQL-shaped SQL by default. See the [project README](https://github.com/slsdotdev/dsqlbase#readme) for the longer motivation.

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
import { createClient, type Session, type SQLStatement } from "dsqlbase";
import * as schema from "./schema";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const session: Session = {
  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await pool.query(query.text, [...query.params]);
    return result.rows as T[];
  },
};

export const dsql = createClient({ schema, session });

// Use it
const recent = await dsql.projects.findMany({
  orderBy: { name: "asc" },
  limit: 10,
  join: { team: true },
});
```

## Links

- [Repository & full docs](https://github.com/slsdotdev/dsqlbase#readme)
- [Issues](https://github.com/slsdotdev/dsqlbase/issues)
- [Contributing](https://github.com/slsdotdev/dsqlbase/blob/main/CONTRIBUTING.md)

## License

MIT.
