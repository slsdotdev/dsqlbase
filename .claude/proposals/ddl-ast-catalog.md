# DDL AST Catalog - Design Proposal

## Overview

The migrations module needs a structured DDL printer instead of string concatenation. This document catalogs the AST nodes required to generate every DDL statement the differ can produce, structurally aligned with the serialized JSON shape of our definition nodes.

The design mirrors the existing `packages/schema/src/migration/ddl/` scaffolding:

- **Commands** — top-level statements (`CREATE_TABLE`, `DROP_INDEX`, etc.)
- **Actions** — subcommands inside `ALTER TABLE`
- **Expressions** — reusable fragments (column definitions, constraints, index columns)

Nodes stay structurally close to the serialized JSON so the factory can map near-mechanically from a schema entry to an AST subtree.

### Input source

The differ operates on serialized JSON — never on `DefinitionNode` class instances. The factory consumes two shapes:

- **Local schema** — array of serialized `toJSON()` outputs. Example: [`packages/tests/src/schema/data/schema.json`](../../packages/tests/src/schema/data/schema.json).
- **Remote schema** — the introspection query result, same top-level shape with minor divergences (e.g. indexes carry a raw `statement` field; table-level `unique` is `[{ name, columns }]` instead of the local `[[refs...]]`). Example: [`packages/tests/src/schema/data/schema-introspection-result.json`](../../packages/tests/src/schema/data/schema-introspection-result.json).

The factory's job is to take either shape and produce the same AST. Where the two diverge (e.g. unique shape, index `statement` field), the factory normalizes.

### Pre-escaped SQL strings

Expression-like fields — `defaultValue`, `check.expression` — are already valid SQL strings in the serialized form (e.g. `"gen_random_uuid()"`, `"\"task_status\" IN ('open', ...)"`). The printer emits them raw without re-escaping or re-parsing. Identifier-like fields (table names, column names) get quoted by the printer.

### DSQL coverage assumption

DSQL's docs enumerate supported features but aren't exhaustive. If a PostgreSQL DDL statement isn't mentioned as unsupported, assume it works (e.g. `ALTER DOMAIN`, `DROP DOMAIN`, `ALTER INDEX`, `DROP FUNCTION` — all absent from the supported-DDL table but available in practice).

The exception is `ALTER TABLE`, whose sub-actions are explicitly enumerated. Anything not in that enumeration (like `ADD CONSTRAINT`) genuinely doesn't work.

### References

- Supported DDL: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html
- Syntax subsets: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-subsets.html
- `CREATE INDEX ASYNC`: https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html
- Migrations proposal: [migrations-module-mvp.md](./migrations-module-mvp.md) *(superseded in parts — see [Divergences](#divergences-from-migrations-module-mvp) below)*

---

## DSQL DDL constraints (summary)

Supported (treat as available even when absent from DSQL's docs, per the coverage assumption above):

- `CREATE/ALTER/DROP TABLE` (ALTER is narrow — see below)
- `CREATE [UNIQUE] INDEX ASYNC`, `DROP INDEX`, `ALTER INDEX`
- `CREATE/ALTER/DROP VIEW` (`CREATE OR REPLACE VIEW` available)
- `CREATE/ALTER/DROP SEQUENCE` (with `CACHE` constraints: must be `1` or `>= 65536`)
- `CREATE/ALTER/DROP DOMAIN`
- `CREATE/ALTER/DROP FUNCTION` with `LANGUAGE SQL` only
- `CREATE/DROP SCHEMA`

`ALTER TABLE` subcommands allowed *(this list IS exhaustive — anything outside it genuinely doesn't work)*:

- `ADD [COLUMN] [IF NOT EXISTS]`
- `ALTER COLUMN` — identity actions only (`SET GENERATED`, `SET` sequence option, `RESTART`, `DROP IDENTITY`)
- `RENAME [COLUMN]`, `RENAME CONSTRAINT`, `RENAME TO`
- `SET SCHEMA`, `OWNER TO`

Genuine exclusions (confirmed unsupported):

- `DROP COLUMN`, `ALTER COLUMN TYPE`
- `SET/DROP NOT NULL`, `SET/DROP DEFAULT`
- `ADD/DROP CONSTRAINT` (so constraint changes = table recreate, out of scope)
- Foreign keys

Unions to prune from the current `ast.ts`:

- `DDLCommand`: drop `ALTER_SCHEMA` (no such statement in Postgres)
- `DDLAction`: drop `ADD_CONSTRAINT`, `DROP_CONSTRAINT`; narrow `ALTER_COLUMN` to identity-only variants

Everything else in the existing union stays — domains, indexes, functions, and their ALTER/DROP variants are all fair game.

---

## 1. Commands

### MVP (required by the migrations proposal)

#### `CREATE_TABLE` *(exists, needs full-feature extension)*

Creates a new table with columns, inline constraints, and table-level constraints. Must support the full feature set from day one:

- Column-level constraints: `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, `CHECK`, `DEFAULT` (pre-escaped SQL), domain reference
- Table-level constraints: composite `PRIMARY KEY`, composite `UNIQUE` (with `NULLS [NOT] DISTINCT` and `INCLUDE`), `CHECK`
- Identity columns (`GENERATED ... AS IDENTITY`)
- Generated columns (`GENERATED ALWAYS AS (expr) STORED`) — scoping pending

```sql
CREATE TABLE IF NOT EXISTS "team_members" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  CONSTRAINT "team_members_team_user_unq" UNIQUE ("team_id", "user_id")
);
```

**Emitted when:** a table exists in the local schema but not in the DB.

#### `DROP_TABLE`

Removes a table. Consider supporting `CASCADE` later for dependent views.

```sql
DROP TABLE IF EXISTS "users";
```

**Emitted when:** a table exists in the DB but not in the local schema.

#### `ALTER_TABLE`

Container for one or more action children. Because DSQL requires one DDL per transaction, we'll likely emit one `ALTER_TABLE` statement per action rather than grouping.

```sql
ALTER TABLE "users" ADD COLUMN "nickname" text;
```

**Emitted when:** any column add, rename, `SET SCHEMA`, or identity change is needed.

#### `CREATE_INDEX`

Index creation. Carries an `async: boolean` modifier flag — when `true`, prints `ASYNC` (DSQL default); when `false`, prints a plain `CREATE INDEX` (plain-Postgres / PGlite tests). Supports `UNIQUE`, `IF NOT EXISTS`, per-column `ASC`/`DESC`, per-column `NULLS FIRST/LAST`, `INCLUDE`, `NULLS [NOT] DISTINCT`.

```sql
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS "users_email_idx"
  ON "users" ("email" ASC NULLS LAST)
  INCLUDE ("id")
  NULLS NOT DISTINCT;
```

**Emitted when:** an index exists locally but not in the DB, or its definition changed (drop + recreate).

#### `DROP_INDEX`

Removes an index. Also used to cancel a stuck async build.

```sql
DROP INDEX IF EXISTS "users_email_idx";
```

**Emitted when:** an index exists in the DB but not in the local schema, or an async build failed.

---

### Post-MVP

#### `CREATE_SCHEMA` / `DROP_SCHEMA`

Namespace container. Skip for MVP while we assume `public`. No `ALTER SCHEMA` in Postgres/DSQL.

```sql
CREATE SCHEMA "analytics";
DROP SCHEMA "analytics";
```

**Emitted when:** schema definitions appear/disappear in the local registry.

#### `CREATE_DOMAIN` / `ALTER_DOMAIN` / `DROP_DOMAIN`

User-defined constrained type. All three lifecycle commands are available. The serialized domain shape carries `dataType`, `notNull`, `defaultValue` (pre-escaped SQL), and an optional `check` — the factory maps these directly.

```sql
CREATE DOMAIN "task_status" AS text CHECK (VALUE IN ('open', 'in_progress', 'done'));
ALTER DOMAIN "task_status" SET NOT NULL;
DROP DOMAIN IF EXISTS "task_status";
```

**Emitted when:** a domain appears/disappears, or its constraint/type/default differs.

#### `CREATE_SEQUENCE` / `ALTER_SEQUENCE` / `DROP_SEQUENCE`

Standalone sequence generator. The serialized shape covers `dataType`, `startValue`, `minValue`, `maxValue`, `increment`, `cycle`, `cache`.

**DSQL quirk:** `CACHE` is mandatory and must be `1` or `>= 65536` — the printer should validate this.

```sql
CREATE SEQUENCE IF NOT EXISTS "order_no" CACHE 65536 START WITH 1000;
ALTER SEQUENCE "order_no" RESTART WITH 5000;
DROP SEQUENCE IF EXISTS "order_no";
```

**Emitted when:** a sequence appears/disappears, or any parameter differs.

#### `CREATE_VIEW` / `ALTER_VIEW` / `DROP_VIEW`

Virtual relation over a query. DSQL supports `CREATE OR REPLACE VIEW` — the safest way to reconcile query-text changes. `ALTER VIEW` is limited to property changes (owner, rename, `SET SCHEMA`, option toggles, column default).

```sql
CREATE OR REPLACE VIEW "active_users" AS SELECT * FROM "users" WHERE "disabled" = false;
ALTER VIEW "active_users" RENAME TO "live_users";
DROP VIEW IF EXISTS "active_users";
```

**Emitted when:** view exists locally but not in DB (create), query text differs (`OR REPLACE`), or properties/name differ (alter).

#### `CREATE_FUNCTION` / `ALTER_FUNCTION` / `DROP_FUNCTION`

`LANGUAGE SQL` only in DSQL. All three lifecycle commands assumed available per the coverage assumption.

```sql
CREATE FUNCTION "full_name"("u" users) RETURNS text LANGUAGE SQL AS $$ SELECT u.first || ' ' || u.last $$;
```

#### `ALTER_INDEX`

Rename or move index. Narrow surface (Postgres doesn't expose much).

```sql
ALTER INDEX "users_email_idx" RENAME TO "users_email_unq_idx";
```

---

## 2. Actions (children of `ALTER_TABLE`)

DSQL's `ALTER TABLE` is narrow. These are the only actions the printer needs.

#### `ADD_COLUMN` *(MVP)*

Adds a new column. Supports `IF NOT EXISTS`.

**Caveat (already noted in migrations-module-mvp.md):** no `DEFAULT` on `ADD COLUMN` in DSQL, and adding `NOT NULL` to a non-empty table fails.

```sql
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "nickname" text;
```

**Emitted when:** a local column isn't in the DB table.

#### `RENAME` *(post-MVP)*

Renames the table itself. Requires explicit rename intent — the differ can't infer renames from a drop+create diff alone.

```sql
ALTER TABLE "users" RENAME TO "accounts";
```

**Emitted when:** user declares an explicit rename (not auto-detected).

#### `RENAME_COLUMN` *(post-MVP)*

Same — needs explicit hint to disambiguate from drop + add.

```sql
ALTER TABLE "users" RENAME COLUMN "email" TO "email_address";
```

#### `RENAME_CONSTRAINT` *(post-MVP)*

Renames a check/unique/PK constraint. Low priority since the generator can emit stable constraint names.

```sql
ALTER TABLE "users" RENAME CONSTRAINT "users_check" TO "users_age_check";
```

#### `SET_SCHEMA` *(post-MVP)*

Moves a table to a different schema.

```sql
ALTER TABLE "users" SET SCHEMA "archive";
```

**Emitted when:** a local table's schema differs from the DB.

#### `ALTER_COLUMN_IDENTITY` *(post-MVP, replaces generic `ALTER_COLUMN`)*

DSQL's only `ALTER COLUMN` variants: `SET GENERATED {ALWAYS|BY DEFAULT}`, `SET` sequence option (e.g. `INCREMENT BY`), `RESTART [WITH n]`, and `DROP IDENTITY [IF EXISTS]`.

```sql
ALTER TABLE "orders" ALTER COLUMN "id" SET GENERATED BY DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "id" RESTART WITH 1000;
ALTER TABLE "orders" ALTER COLUMN "id" DROP IDENTITY IF EXISTS;
```

**Emitted when:** an identity column's generation mode, underlying sequence options, or identity-ness itself differs.

---

## 3. Expressions

### MVP

#### `COLUMN_DEFINITION` *(exists, needs extension)*

Full column spec inside `CREATE TABLE` or `ADD COLUMN`. Current node covers name/type/notNull/PK/unique/default/check. Extensions to add for MVP:

- `domain` — reference to a user-defined domain (serialized as `{ kind: "REFERENCE", name }`); prints the domain name in place of `dataType`
- `identity` — child `IDENTITY_CONSTRAINT` expression for `GENERATED ... AS IDENTITY` columns
- `generated` — child `GENERATED_EXPRESSION` for computed columns (`GENERATED ALWAYS AS (expr) STORED`) *(scoping pending in the definition layer)*

`defaultValue` stays a raw pre-escaped SQL string — the printer passes it through.

#### `CHECK_CONSTRAINT` *(exists)*

Boolean expression enforced per row. Used both inline on a column and at table level. The `expression` field is a pre-escaped SQL string.

```sql
CONSTRAINT "chk_task_status" CHECK ("task_status" IN ('open', 'in_progress', 'done'))
```

#### `PRIMARY_KEY_CONSTRAINT` *(new, MVP)*

Table-level PK covering one or more columns, with optional `INCLUDE`. Always MVP — composite PKs are a first-class feature. Single-column PKs may still be emitted inline via `COLUMN_DEFINITION.isPrimaryKey` for ergonomics.

```sql
CONSTRAINT "orders_pkey" PRIMARY KEY ("tenant_id", "order_id") INCLUDE ("created_at")
```

**Emitted when:** a local table declares a composite PK (or we choose table-level form for single-column PKs).

#### `UNIQUE_CONSTRAINT` *(new, MVP)*

Table-level uniqueness across one or more columns. Supports `NULLS [NOT] DISTINCT` and `INCLUDE`. The factory normalizes the shape divergence: local `[[refs...]]` → synthesize a name; remote `[{ name, columns }]` → use the given name.

```sql
CONSTRAINT "team_members_team_user_unq" UNIQUE ("team_id", "user_id")
```

**Emitted when:** `TableDefinition.unique(cb)` produced a unique tuple, either inline in `CREATE_TABLE` or (future) as a standalone alter.

#### `INDEX_COLUMN_DEFINITION` *(new, MVP)*

Mirrors the serialized `INDEX_COLUMN` shape. Column reference with `ASC`/`DESC` and `NULLS FIRST/LAST`.

```sql
"email" ASC NULLS LAST
```

Used inside `CREATE_INDEX`.

---

### Post-MVP

#### `IDENTITY_CONSTRAINT`

Column-level `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY` with optional sequence options (inherits the same `CACHE`/`INCREMENT`/`MIN`/`MAX`/`CYCLE`/`START` set as `CREATE_SEQUENCE`). Shares the sequence-option expression with `CREATE_SEQUENCE`/`ALTER_SEQUENCE` to avoid duplication.

```sql
id bigint GENERATED ALWAYS AS IDENTITY (CACHE 65536 START WITH 1)
```

#### `GENERATED_EXPRESSION`

`GENERATED ALWAYS AS (expr) STORED` — computed column. Will land once generated columns are scoped in the definition layer.

```sql
full_name text GENERATED ALWAYS AS (first || ' ' || last) STORED
```

#### `LIKE_CLAUSE` *(niche)*

`LIKE source_table [INCLUDING...|EXCLUDING...]` inside `CREATE TABLE` — copies structure. Rarely used from an ORM, likely skip.

---

## Priority order

1. **Fill MVP gaps:**
   - Commands: `DROP_TABLE`, `ALTER_TABLE`, `CREATE_INDEX` (with `async` flag), `DROP_INDEX`
   - Actions: `ADD_COLUMN`
   - Expressions: `INDEX_COLUMN_DEFINITION`, `UNIQUE_CONSTRAINT`, `PRIMARY_KEY_CONSTRAINT`, `COLUMN_DEFINITION` domain-reference extension
   - Factory: map from serialized JSON (both local and introspection shapes) to the above AST nodes, normalizing the `unique` shape divergence.

2. **Prune from `ast.ts`:**
   - From `DDLCommand`: `ALTER_SCHEMA` only (not a real Postgres statement). Keep all domain/index/function variants.
   - From `DDLAction`: `ADD_CONSTRAINT`, `DROP_CONSTRAINT`; narrow `ALTER_COLUMN` to identity-only variants.

3. **Post-MVP:** schemas (CREATE/DROP), sequences, views, domains (ALTER/DROP), functions, `ALTER_INDEX`, the narrow `ALTER_COLUMN` identity variants, and `IDENTITY_CONSTRAINT` / `GENERATED_EXPRESSION` expressions.

---

## Resolved decisions

1. **`ASC`/`DESC` on index columns** — supported. Emit unconditionally.

2. **`CREATE INDEX ASYNC` flag** — `CREATE_INDEX` carries an `async: boolean` modifier. DSQL callers set it to `true`; plain-Postgres / PGlite callers set `false`.

3. **One action per `ALTER TABLE`** — one statement per action. The one-DDL-per-transaction rule removes any benefit to grouping.

4. **Identity columns** — both forms supported. Standalone `SEQUENCE` + column reference works today via `SequenceDefinition`. Column-attached `GENERATED ... AS IDENTITY` lands post-MVP alongside the broader generated-columns work (which is still being scoped at the definition layer).

---

## Divergences from `migrations-module-mvp`

Folding in learnings since the original migrations proposal:

- **Differ operates on JSON, not class instances.** The differ and factory consume serialized outputs (`toJSON()` arrays and introspection-query JSON). The original proposal already assumed this; reinforced here.
- **Local vs remote shape divergences** — indexes have `statement` on the remote side only (used for textual comparison, not printing); `unique` is `[[refs...]]` locally and `[{ name, columns }]` remotely. The factory normalizes.
- **Index column resolution is solved.** The original proposal's open question about index column names is resolved — local indexes serialize full `INDEX_COLUMN` children with column references.
- **DSQL support is broader than the docs claim.** `ALTER DOMAIN`, `DROP DOMAIN`, `ALTER INDEX`, `DROP FUNCTION`, etc. are all considered available.
- **`CREATE TABLE` is full-featured from day one** — table-level constraints (composite PK, composite UNIQUE, table-level CHECK) are MVP, not deferred.
