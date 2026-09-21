# Schema

_Audience: application developers._

Schemas are TypeScript values built from `dsqlbase/schema`. The same definition drives the typed client at runtime and the migration runner's DDL. Source: `packages/dsqlbase/src/schema/`, built on the abstract model in `packages/core/src/definition/`.

## Tables

```ts
import { table, uuid, text, varchar, boolean, datetime } from "dsqlbase/schema";

export const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", 100).notNull(),
  email: text("email").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: datetime("created_at").notNull().defaultNow(),
});
```

The object key (`createdAt`) is the property name you use in queries; the first argument (`"created_at"`) is the column name in the database. Field names are unique per table across columns *and* [relations](./relations.md) — the client addresses both as fields of one model. **Two fields may not map to the same column name** — `table()` throws when they do, because the result resolver reads rows by column name and one field would silently shadow the other. `table()` takes a flat `Record<string, ColumnDefinition>`; `TableDefinition.columns` is the single source of truth for both the runtime and migrations.

### Column modifiers

Every column supports `.notNull()`, `.primaryKey()`, `.unique()`, `.default(value | sql)`, `.check(expr)`, `.$type<T>()` (narrow the TypeScript type without changing the SQL type), `.$onCreate(fn)` and `.$onUpdate(fn)` (client-side value hooks). `uuid()` adds `.defaultRandom()`; `timestamp()` / `datetime()` add `.defaultNow()`.

### Table-level definitions

```ts
users.index("users_email_idx", { unique: true }).columns((c) => [c.email]);
members.unique((c) => [c.teamId, c.userId]);           // UNIQUE constraint
members.primaryKey((c) => [c.teamId, c.userId]);       // composite PK
tasks.index("tasks_due_idx").columns((c) => [c.dueDate]).include((c) => [c.status]);
```

Indexes support `unique`, `include`, `distinctNulls`, and nulls-first/last ordering. Partial (`WHERE`) and expression indexes are not modelled yet.

**A table has at most one primary key.** Use `.primaryKey()` on a single column, or `table.primaryKey((c) => [...])` for a composite key — never both, and never two of either. Declaring more than one is rejected when the client is created and by the migration validator (`MULTIPLE_PRIMARY_KEYS`); SQL allows only one `PRIMARY KEY` per table.

## Column types

| Constructor(s) | PG type | Notes |
|---|---|---|
| `text`, `varchar(name, length)`, `char` | `text`, `varchar(n)`, `char(n)` | |
| `uuid` | `uuid` | `.defaultRandom()` → `gen_random_uuid()` |
| `smallint`/`int2`, `int`/`int4`, `bigint`/`int8` | integers | `bigint` values are JS `bigint` via codec |
| `numeric`/`decimal`, `real`/`float4`, `double`/`float8` | numerics | |
| `boolean`/`bool` | `boolean` | |
| `bytea` | `bytea` | |
| `date`, `time`, `timestamp`/`datetime` | temporal | mode options control JS representation (`DateTimeMode`) |
| `interval`/`duration` | `interval` | `Duration` object or ISO string via `mode` |
| `json` | `json` | `unknown`; use `.$type<T>()` to narrow. No validation, no `jsonb` yet |
| `array(inner)` | `inner[]` | |
| `identity(name, options)` | `GENERATED … AS IDENTITY` | the only column kind DSQL lets you alter after creation |

Source: `packages/dsqlbase/src/schema/columns/`.

## Domains and enums

```ts
import { domain, $enum } from "dsqlbase/schema";
import { sql } from "dsqlbase";

const taskStatus = $enum("task_status", ["todo", "in_progress", "done"]);
const slug = domain("slug").check((v) => sql`${v} ~ '^[a-z0-9-]+$'`);

const tasks = table("tasks", {
  status: taskStatus.column("status").notNull(),
  slug: slug.column("slug").notNull(),
});
```

`$enum` is a `text` domain with a `CHECK (v IN (...))` constraint — DSQL has no native enum type. Domains support `.notNull()`, `.default()`, `.check()`, `.$type<T>()`, and `.column(name)` to create a column of that domain.

## Sequences and namespaces

```ts
import { sequence, namespace } from "dsqlbase/schema";

const taskNumberSeq = sequence("task_number_seq").startWith(1).incrementBy(1).cache(65536);
const billing = namespace("billing");
const invoices = billing.table("invoices", { /* … */ });
```

DSQL requires sequence `CACHE` to be `1` or `>= 65536`; the migration validator enforces this. `namespace()` (alias `schema()`) scopes tables, domains, and sequences to a PG schema.

## Exporting the schema

Export every table, relation, domain, and sequence from one module and pass the module to `createClient({ schema })` and to the migration runner. The client keys models by the export name (`dsql.users`), not the table name. A full example lives at `packages/tests/src/db/schema/schema.ts`.

## Related

- [Relations](./relations.md)
- [DSQL notes](./dsql-notes.md) — what you can and cannot change after a table exists
- [Migrations](./migrations.md)
