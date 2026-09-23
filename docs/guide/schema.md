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

Every column supports `.notNull()`, `.primaryKey()`, `.unique()`, `.readOnly()`, `.default(value | sql)`, `.check(expr)`, `.$type<T>()` (narrow the TypeScript type without changing the SQL type), `.$onCreate(fn)` and `.$onUpdate(fn)` (client-side value hooks). `uuid()` adds `.defaultRandom()`; `timestamp()` / `datetime()` add `.defaultNow()`.

`.readOnly()` marks a column **system-managed**: it is read like any other — selectable,
filterable, orderable — but it is not part of `create`'s `data` or `update`'s `set`, in the
types or at runtime. A field that arrives there anyway, through an untyped spread, is dropped
rather than refused. Use it for a value the application must not set; it changes nothing about
the generated DDL, so migrations are unaffected.

### Tenant scopes

`tenantScope(claims)` declares a set of claim columns shared by every table inside one tenant
boundary. The columns it hands a table are read-only *and* filled by the client, from the
identity it was scoped to:

```ts
const ws = tenantScope({ workspaceId: uuid("workspace_id").notNull() });

const invoices = ws.table("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});
```

Every claim column must be `notNull`, a table may not redeclare one, and one claim name must
have the same type on every table that declares it. The claim key is the field name, not the
column name. A composite primary key including the claim — `(workspace_id, id)` — is allowed.

Claim columns are ordinary columns in the emitted DDL: no foreign key, no index, nothing a
migration treats specially. Declare the index yourself, leading with the claim. The full rules,
and what a scoped client can do, are in [Tenancy](./tenancy.md).

### Table-level definitions

```ts
users.index("users_email_idx", { unique: true }).columns((c) => [c.email]);
members.unique((c) => [c.teamId, c.userId]);           // UNIQUE constraint
members.primaryKey((c) => [c.teamId, c.userId]);       // composite PK
tasks.index("tasks_due_idx").columns((c) => [c.dueDate]).include((c) => [c.status]);
```

Indexes support `unique`, `include`, `distinctNulls`, and nulls-first/last ordering. Partial (`WHERE`) and expression indexes are not modelled yet.

**A table has at most one primary key.** Use `.primaryKey()` on a single column, or `table.primaryKey((c) => [...])` for a composite key — never both, and never two of either. Declaring more than one is rejected when the client is created and by the migration validator (`MULTIPLE_PRIMARY_KEYS`); SQL allows only one `PRIMARY KEY` per table.

### Table metadata

`.meta()` attaches arbitrary data to a table, surfaced on every result row as part of
[`$$meta`](./querying.md#meta-on-every-row):

```ts
const tasks = table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
}).meta({ __typename: "Task" });

// later
row.$$meta.__typename; // "Task", typed from the declaration
```

It chains off `table()` — that is what carries the type through — and describes the table to
your application, never to the database. Metadata is excluded from `toJSON`, so it never
reaches a migration; changing it produces no DDL.

The built-in keys `key`, `table` and `schema` are set from the schema itself and may not be
redeclared. `$$meta` and `$$key` are reserved field names: a column or a relation of either
name throws.

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
