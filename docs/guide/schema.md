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

The object key (`createdAt`) is the property name you use in queries; the first argument (`"created_at"`) is the column name in the database. Field names are unique per table across columns _and_ [relations](./relations.md) — the client addresses both as fields of one model. **Two fields may not map to the same column name** — `table()` throws when they do, because the result resolver reads rows by column name and one field would silently shadow the other. `table()` takes a flat `Record<string, ColumnDefinition>`; `TableDefinition.columns` is the single source of truth for both the runtime and migrations.

### Column modifiers

Every column supports `.notNull()`, `.primaryKey()`, `.unique()`, `.readOnly()`, `.default(value | sql)`, `.check(expr)`, `.$type<T>()` (narrow the TypeScript type without changing the SQL type), `.$onCreate(fn)` and `.$onUpdate(fn)` (client-side value hooks: `$onCreate` fills the column on every insert and `$onUpdate` on every update, unless the call sets the column itself; a hook's value is validated and encoded like any written value, and it writes a `.readOnly()` column too). `uuid()` adds `.defaultRandom()`; `timestamp()` / `datetime()` add `.defaultNow()`.

`.readOnly()` marks a column **system-managed**: it is read like any other — selectable,
filterable, orderable — but it is not part of `create`'s `data` or `update`'s `set`, in the
types or at runtime. A field that arrives there anyway, through an untyped spread, is dropped
rather than refused. Use it for a value the application must not set; it changes nothing about
the generated DDL, so migrations are unaffected.

### Global ids

`guid(name, key?)` is a `uuid` column whose values leave the ORM as opaque strings naming both
the row and its table. A table whose primary key is exactly one `guid()` column is a **node**,
addressable by [`$findByGlobalId`](./global-ids.md):

```ts
const authors = table("authors", {
  id: guid("id").primaryKey().defaultRandom(), // node key: the alias "authors"
  name: text("name").notNull(),
});

const articles = table("articles", {
  id: guid("id").primaryKey().defaultRandom(),
  authorId: guid("author_id", "authors").notNull(), // points at the authors node
});
```

It serializes exactly as `uuid()`, so adopting it on an existing column produces no DDL. Full
rules — node keys, relation pairs, what is and is not accepted as input — are in
[Global ids](./global-ids.md).

### Tenant scopes

`tenantScope(claims)` declares a set of claim columns shared by every table inside one tenant
boundary. The columns it hands a table are read-only _and_ filled by the client, from the
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
members.unique((c) => [c.teamId, c.userId]); // UNIQUE constraint
members.primaryKey((c) => [c.teamId, c.userId]); // composite PK
tasks
  .index("tasks_due_idx")
  .columns((c) => [c.dueDate])
  .include((c) => [c.status]);
```

Each of these returns the index or constraint it declares, not the table, so call them as
separate statements after `table(...)` — chained onto it, the variable would hold the
constraint, and nothing would register the table.

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

## Unions

`union()` groups tables that can stand in for one another — what GraphQL calls a union or an
interface. Key every member by the alias it is exported under:

```ts
import { union } from "dsqlbase/schema";

export const photos = table("photos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id", "users").notNull(),
  photoUrl: text("photo_url").notNull(),
});

export const videos = table("videos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id", "users").notNull(),
  videoUrl: text("video_url").notNull(),
});

export const posts = union({ photos, videos });
// posts.columns: { id, userId } — the shared fields
```

`posts.columns` holds the **shared fields**: the fields every member declares with the same
type. A field whose type differs on one member is left out rather than refused. Relations use
the shared fields to target a union (see [Relations](./relations.md#relations-to-a-union)).

When the client is built, it throws if any of these hold:

- a member is keyed by something other than its schema alias;
- a member is not in the schema;
- the union's alias is also a table's name.

A union with no members, or one that contains another union, throws when it is declared.

A union produces no DDL. The migration runner ignores it, and exporting it alongside its
members is enough.

## Column types

| Constructor(s)                                          | PG type                         | Notes                                                                                     |
| ------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `text`, `varchar(name, length)`, `char`                 | `text`, `varchar(n)`, `char(n)` |                                                                                           |
| `uuid`                                                  | `uuid`                          | `.defaultRandom()` → `gen_random_uuid()`                                                  |
| `smallint`/`int2`, `int`/`int4`, `bigint`/`int8`        | integers                        | `bigint` values are JS `bigint` via codec                                                 |
| `numeric`/`decimal`, `real`/`float4`, `double`/`float8` | numerics                        |                                                                                           |
| `boolean`/`bool`                                        | `boolean`                       |                                                                                           |
| `bytea`                                                 | `bytea`                         |                                                                                           |
| `date`, `time`, `timestamp`/`datetime`                  | temporal                        | mode options control JS representation (`DateTimeMode`)                                   |
| `interval`/`duration`                                   | `interval`                      | `Duration` object or ISO string via `mode`                                                |
| `jsonb`, `json`                                         | `jsonb`, `json`                 | any JSON value; `unknown` until `.$type<T>()` or `.schema(s)` (below). Prefer `jsonb`     |
| `array`                                                 | `jsonb`                         | a JSON array, checked on every write and read; `.$type<T>()` takes the item or array type |
| `record`                                                | `jsonb`                         | a JSON object, checked on every write and read; `.$type<T>()` takes the object type       |
| `identity(name, options)`                               | `GENERATED … AS IDENTITY`       | the only column kind DSQL lets you alter after creation                                   |

Source: `packages/dsqlbase/src/schema/columns/`.

Each constructor also sets the column's **runtime type** — the kind of value it holds, for
querying — which decides the filter operators it takes, whether a bare value means `eq`, and
whether it can be ordered by. `domain()` and `$enum()` columns are `string`. See
[Operators by column type](./querying.md#operators-by-column-type).

## JSON columns

`jsonb(name)` and `json(name)` hold any JSON value — an object, an array, a string, a number or a
boolean. `null` is SQL `NULL`, never a JSON `null`. Prefer `jsonb`: Postgres stores it parsed and
can compare it, while `json` keeps the text as written and has no equality operator. In Aurora
DSQL a value is limited to 1 MiB compressed, and neither type can be indexed.

```ts
import { z } from "zod";
import { jsonb, table, uuid } from "dsqlbase/schema";

const Settings = z.object({
  theme: z.enum(["light", "dark"]).default("light"),
  since: z.coerce.date(),
});

export const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  settings: jsonb("settings").schema(Settings), // validated, typed from the schema
  tags: jsonb("tags").$type<string[]>(), // typed only
});
```

`array(name)` and `record(name)` are `jsonb` columns that hold an array, or an object, at the
top level. The shape is checked on every write and every read, with or without a schema, and
they take the operators of their shape (see
[Operators by column type](./querying.md#operators-by-column-type)):

```ts
export const boards = table("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tags: array("tags").$type<string>(), // string[]; $type<string[]>() is the same
  labels: array("labels").schema(z.array(z.string()).min(1)),
  limits: record("limits").$type<{ cpu: number; memory?: number }>(), // exactly as given
  quotas: record("quotas").schema(z.record(z.string(), z.number())),
});
```

Untyped, they read as `unknown[]` and `Record<string, unknown>`. `.schema()` takes a schema for
the whole value, and the types refuse one whose output is not an array (or an object).

`.$type<T>()` only types the column; nothing checks the values. `.schema(s)` takes any
[Standard Schema](https://standardschema.dev) — zod, valibot, arktype — with none of them a
dependency, and validates every write and every read:

- **A write** takes the schema's input type, validates it, and stores the schema's **output**
  in its JSON form: `create({ data: { settings: { since: "2026-10-01" } } })` stores
  `{"theme":"light","since":"2026-10-01T00:00:00.000Z"}`. Defaults are stored, so they are what
  the row holds.
- **The output must read back as itself.** After validating, the write validates the stored
  form again and compares. Defaults, coercions and refinements pass. A **transform** fails —
  its output no longer validates as its input, or changes on a second pass — and throws on the
  first write that reaches it. Transforming schemas are not supported.
- **A read** validates the stored value and returns the schema's output, so the type holds for
  every row: `user.settings.since` is a `Date`. A stored value the schema refuses — written by
  raw SQL, or under an older schema — fails the whole read.
- **The schema must validate synchronously.** An async refinement throws.
- **`.default(value)`** is validated where it is declared, whichever order `.default()` and
  `.schema()` are called in.
- **Filters are not validated.** A value in `where`, or given to `Column.param()`, is compared
  with stored values rather than stored: it is typed by the schema's output and sent as given,
  and may be only a fragment of a document.

Every failure throws `ColumnValidationError` (exported from `dsqlbase`), with `code`
(`invalid`, `not_json`, `unstable`, `async`), the database `column` name, the `phase` (`write`
or `read`) and the schema's `issues`.

A `json` column filters by `exists` only and cannot be compared by `distinct`. A `jsonb`,
`array()` or `record()` column also takes `eq`, `neq` and `contains` (a fragment of the value),
a `record()` also `hasKey`, and `distinct` compares them. None takes a bare value in `where` or can be an `orderBy` key (see
[Operators by column type](./querying.md#operators-by-column-type)).

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
const invoices = billing.table("invoices", {
  /* … */
});
```

DSQL requires sequence `CACHE` to be `1` or `>= 65536`; the migration validator enforces this. `namespace()` (alias `schema()`) scopes tables, domains, and sequences to a PG schema.

## Exporting the schema

Export every table, relation, union, domain, and sequence from one module and pass the module to `createClient({ schema })` and to the migration runner. The client keys models by the export name (`dsql.users`), not the table name. A full example lives at `packages/tests/src/db/schema/schema.ts`.

## Related

- [Relations](./relations.md)
- [DSQL notes](./dsql-notes.md) — what you can and cannot change after a table exists
- [Migrations](./migrations.md)
