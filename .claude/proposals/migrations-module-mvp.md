# Migrations Module - MVP Design Proposal

## Overview

A declarative, introspection-based schema migrator for Aurora DSQL. Instead of maintaining migration files, the migrator diffs the local schema definitions against the live database and generates + executes the necessary DDL to converge them.

### Constraints (Aurora DSQL)

- **One DDL per transaction** — no multi-statement DDL transactions, no DDL+DML mixing
- **ALTER TABLE is limited** — only `ADD COLUMN`, identity column changes, `RENAME`, `SET SCHEMA`; no `DROP COLUMN`, no `ALTER COLUMN TYPE`, no `ADD/DROP CONSTRAINT`
- **Indexes are async** — `CREATE INDEX ASYNC` returns a `job_id`; must poll/wait via `sys.wait_for_job(job_id)`
- **No foreign keys** — relations are application-level only (LEFT JOIN LATERAL)
- **OCC retries** — DDL triggers catalog version bumps; subsequent sessions get `SQLSTATE 40001` / `OC001`; the transaction client handles retries with backoff

### MVP Scope

**Supported operations:**

1. `CREATE TABLE` — tables in local schema not in DB
2. `DROP TABLE` — tables in DB not in local schema
3. `ADD COLUMN` — columns in local table not in DB table
4. `CREATE INDEX ASYNC` — indexes in local schema not in DB + wait for completion
5. `DROP INDEX` — indexes in DB not in local schema

**Deferred (post-MVP):**

- Column type changes (requires table recreate)
- Drop column (DSQL doesn't support it)
- Constraint changes on existing columns
- Rename operations
- Sequences, views, domains

---

## Architecture

The module lives in `packages/schema/src/migrations/` and consists of five pieces:

```
migrations/
  index.ts          — public API: migrate()
  introspect.ts     — DB schema introspection query + result parsing
  diff.ts           — consume-and-mark differ producing an operation plan
  ddl.ts            — DDL SQL generation from operations
  types.ts          — shared types for the module
```

### Dependencies

The migrator operates on the **serialized schema** (the `.toJSON()` output), not on the runtime class instances. This keeps it decoupled from the definition classes and means it can work with a JSON payload from any source.

It uses the `Session` interface from `@dsqlbase/core/runtime` for executing queries. The caller provides a session (which should have OCC retry logic baked in).

---

## 1. Types (`types.ts`)

These types represent the **normalized** view of both local and DB schemas, used as the common language for diffing.

```typescript
/** Canonical column representation for diffing */
interface SchemaColumn {
  name: string; // DB column name (snake_case)
  dataType: string; // Canonical type (see type normalizer)
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
}

/** Canonical index representation for diffing */
interface SchemaIndex {
  name: string;
  columns: string[]; // Column names the index covers
  unique: boolean;
}

/** Canonical table representation for diffing */
interface SchemaTable {
  name: string;
  columns: Map<string, SchemaColumn>;
  indexes: Map<string, SchemaIndex>;
}

/** The full DB snapshot, keyed by table name */
type DatabaseSchema = Map<string, SchemaTable>;

/** Operation types the differ can produce */
type MigrationOp =
  | { type: "create_table"; table: SchemaTable }
  | { type: "drop_table"; tableName: string }
  | { type: "add_column"; tableName: string; column: SchemaColumn }
  | { type: "create_index"; tableName: string; index: SchemaIndex }
  | { type: "drop_index"; indexName: string };

/** Ordered list of operations to execute */
interface MigrationPlan {
  operations: MigrationOp[];
  /** Warnings for detected changes we can't handle in MVP */
  warnings: string[];
}
```

### Why `Map` instead of plain objects

The differ needs to "consume" items as it processes them — `Map.delete()` after getting each item. This is the core of the consume-and-mark strategy. Plain objects work too (with `delete obj[key]`), but `Map` makes the intent explicit and avoids prototype chain issues with table names like `constructor`.

---

## 2. Introspection (`introspect.ts`)

A single query that returns the full schema state from `information_schema` and `pg_catalog`, parsed into `DatabaseSchema`.

### The introspection query

```sql
SELECT json_build_object(
  'tables', (
    SELECT json_agg(t)
    FROM (
      SELECT
        c.relname AS name,
        (
          SELECT json_agg(json_build_object(
            'name', a.attname,
            'dataType', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'notNull', a.attnotnull,
            'primaryKey', EXISTS (
              SELECT 1 FROM pg_constraint con
              WHERE con.conrelid = c.oid
                AND con.contype = 'p'
                AND a.attnum = ANY(con.conkey)
            ),
            'unique', EXISTS (
              SELECT 1 FROM pg_constraint con
              WHERE con.conrelid = c.oid
                AND con.contype = 'u'
                AND con.conkey = ARRAY[a.attnum]
            )
          ) ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attnum > 0
            AND NOT a.attisdropped
        ) AS columns,
        (
          SELECT json_agg(json_build_object(
            'name', ic.relname,
            'columns', (
              SELECT json_agg(pa.attname ORDER BY array_position(ix.indkey, pa.attnum))
              FROM pg_attribute pa
              WHERE pa.attrelid = c.oid
                AND pa.attnum = ANY(ix.indkey)
            ),
            'unique', ix.indisunique
          ))
          FROM pg_index ix
          JOIN pg_class ic ON ic.oid = ix.indexrelid
          WHERE ix.indrelid = c.oid
            AND NOT ix.indisprimary  -- exclude pkey indexes from explicit index list
        ) AS indexes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'  -- ordinary tables only
      ORDER BY c.relname
    ) t
  )
) AS schema;
```

This returns a single JSON object. We parse it and build the `DatabaseSchema` map, running each column's `dataType` through the type normalizer.

### Type normalization

PostgreSQL returns canonical type names from `pg_catalog.format_type()` that differ from what users write in schema definitions. We need a mapping:

| `format_type()` output        | Canonical form     | Schema definition source |
| ----------------------------- | ------------------ | ------------------------ |
| `uuid`                        | `uuid`             | `uuid()`                 |
| `text`                        | `text`             | `text()`                 |
| `boolean`                     | `boolean`          | `boolean()`              |
| `integer`                     | `integer`          | `int()`                  |
| `bigint`                      | `bigint`           | `bigint()`               |
| `smallint`                    | `smallint`         | `smallint()`             |
| `real`                        | `real`             | `real()`                 |
| `double precision`            | `double precision` | `double()`               |
| `numeric`                     | `numeric`          | `numeric()`              |
| `date`                        | `date`             | `date()`                 |
| `character varying(N)`        | `varchar(N)`       | `varchar(name, N)`       |
| `character(N)`                | `char(N)`          | `char(name, N)`          |
| `timestamp with time zone`    | `timestamptz`      | `datetime()`             |
| `timestamp without time zone` | `timestamp`        | `timestamp()`            |
| `bytea`                       | `bytea`            | `bytea()`                |
| `interval`                    | `interval`         | `duration()`             |
| `jsonb`                       | `jsonb`            | `json()`                 |

The normalizer is a function: `normalizeType(pgType: string): string` that handles these mappings. Both the introspection result and the local schema column types get normalized before comparison.

**For the local schema side**, we also need a mapping from the `dataType` stored in `ColumnDefinition.toJSON()` to the same canonical form. Looking at the serialized output in `schema.json`, columns store their `dataType` as-is (e.g., `"UUID"`, `"varchar(100)"`, `"timestamp"`, `"int"`). So the local normalizer lowercases and maps aliases:

| Local `dataType` | Canonical form |
| ---------------- | -------------- |
| `UUID`           | `uuid`         |
| `varchar(N)`     | `varchar(N)`   |
| `text`           | `text`         |
| `boolean`        | `boolean`      |
| `int`            | `integer`      |
| `timestamp`      | `timestamptz`  |
| `date`           | `date`         |
| `interval`       | `interval`     |

This is a single `normalizeLocalType(dataType: string): string` function.

---

## 3. Differ (`diff.ts`)

The core diffing logic using the consume-and-mark approach.

### Algorithm

```ts
function diff(local: SerializedSchema, db: DatabaseSchema): MigrationPlan

  // Build a mutable copy of DB state
  dbTables = new Map(db)  // clone so we can mutate
  operations = []
  warnings = []

  // Phase 1: Process each local table
  for each entry in local where kind === "TABLE":
    localTable = parseLocalTable(entry)  // normalize to SchemaTable
    dbTable = dbTables.get(localTable.name)

    if dbTable is undefined:
      // New table — CREATE TABLE
      operations.push({ type: "create_table", table: localTable })
    else:
      // Existing table — reconcile columns and indexes
      dbTables.delete(localTable.name)  // mark as seen

      // Diff columns
      dbColumns = new Map(dbTable.columns)  // clone for consume
      for each [colAlias, localCol] of localTable.columns:
        dbCol = dbColumns.get(localCol.name)
        if dbCol is undefined:
          // New column
          operations.push({ type: "add_column", tableName: localTable.name, column: localCol })
        else:
          dbColumns.delete(localCol.name)  // mark as seen
          // Compare normalized types
          if localCol differs from dbCol:
            warnings.push("Column ${table}.${col} changed but ALTER COLUMN is not supported in DSQL")

      // Remaining dbColumns = columns in DB but not in local
      for each remaining dbCol:
        warnings.push("Column ${table}.${col} exists in DB but not in local schema. DROP COLUMN is not supported in DSQL")

      // Diff indexes (same consume-and-mark pattern)
      dbIndexes = new Map(dbTable.indexes)
      for each localIndex of localTable.indexes:
        dbIdx = dbIndexes.get(localIndex.name)
        if dbIdx is undefined:
          operations.push({ type: "create_index", tableName: localTable.name, index: localIndex })
        else:
          dbIndexes.delete(localIndex.name)
          if localIndex differs from dbIdx:
            // index definition changed — drop and recreate
            operations.push({ type: "drop_index", indexName: localIndex.name })
            operations.push({ type: "create_index", tableName: localTable.name, index: localIndex })

      for each remaining dbIdx:
        operations.push({ type: "drop_index", indexName: dbIdx.name })

  // Phase 2: Remaining DB tables = tables to drop
  for each remaining table in dbTables:
    operations.push({ type: "drop_table", tableName: table.name })

  // Phase 3: Sort operations for safe execution order
  return { operations: sortOperations(operations), warnings }
```

### Operation ordering

The `sortOperations` function arranges operations in this order:

1. `create_table` — new tables first (so indexes can reference them)
2. `add_column` — extend existing tables
3. `drop_index` — remove indexes before dropping tables they reference
4. `create_index` — new indexes (async, will wait after execution)
5. `drop_table` — removals last

### Handling `RELATIONS` entries

The differ skips any entry with `kind: "RELATIONS"`. These are application-level metadata and produce no DDL.

### Handling primary key indexes

The introspection query excludes primary key indexes (`NOT ix.indisprimary`). The local schema serialization includes explicit indexes only (not the implicit PK index). So PK indexes don't participate in the diff — they're part of `CREATE TABLE`.

---

## 4. DDL Generator (`ddl.ts`)

Converts `MigrationOp[]` into executable SQL strings.

```typescript
function generateDDL(op: MigrationOp): string;
```

### CREATE TABLE

```sql
CREATE TABLE IF NOT EXISTS "table_name" (
  "col1" uuid PRIMARY KEY NOT NULL,
  "col2" varchar(100) NOT NULL,
  "col3" text,
  ...
);
```

Generated from `SchemaTable.columns`. Column order follows the `Map` iteration order (which mirrors the local schema definition order).

Constraints are inlined: `PRIMARY KEY`, `NOT NULL`, `UNIQUE`.

`IF NOT EXISTS` for idempotency.

### DROP TABLE

```sql
DROP TABLE IF EXISTS "table_name";
```

### ADD COLUMN

```sql
ALTER TABLE "table_name" ADD COLUMN IF NOT EXISTS "col_name" data_type [NOT NULL];
```

**Important DSQL caveat**: When adding a `NOT NULL` column to an existing table with data, there's no `DEFAULT` support in the `ADD COLUMN` action. This means:

- Adding a nullable column: always safe
- Adding a NOT NULL column to an empty table: safe
- Adding a NOT NULL column to a table with existing rows: will fail

For MVP, we generate the DDL as-is and let the error surface. Post-MVP we can add a warning or a multi-step strategy (add nullable, backfill, then... well, DSQL can't alter to NOT NULL either, so this is a genuine limitation to document).

### CREATE INDEX ASYNC

```sql
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS "index_name" ON "table_name" ("col1", "col2");
```

or without `UNIQUE`:

```sql
CREATE INDEX ASYNC IF NOT EXISTS "index_name" ON "table_name" ("col1", "col2");
```

### DROP INDEX

```sql
DROP INDEX IF EXISTS "index_name";
```

### Index column resolution

The local schema's serialized indexes currently only store `name` and `unique` — they don't store which columns they cover. Looking at `IndexDefinition.toJSON()`:

```typescript
toJSON() {
  return {
    kind: this.kind,
    name: this.name,
    unique: this._unique,
  };
}
```

**This is a gap we need to address.** For `CREATE INDEX ASYNC`, we need to know which columns the index covers. Options:

**Option A: Derive from index name convention.** Index names like `tasks_project_idx` imply columns, but this is fragile and ambiguous.

**Option B: Store columns in IndexDefinition.** The `table.index()` call already receives the table context. We'd extend `IndexDefinition` to store column references, and serialize them in `toJSON()`. The index call would accept column names:

```typescript
// Current API
tasks.index("tasks_project_idx");

// Extended API
tasks.index("tasks_project_idx", { columns: ["project_id"] });
```

**Option C: Infer from the index name by matching the table's column names.** Parse the index name, extract segments between table prefix and `_idx` suffix, match against known column names.

**Recommendation: Option B.** It's explicit, type-safe, and the migration path is clean — existing indexes just need columns added to their definition. The `unique` option already exists in the same config object, so `columns` slots in naturally.

This means a small change to `IndexDefinition` and the `table.index()` method — but no breaking change since `columns` can be optional (indexes without columns specified just get a warning and are skipped in migration).

---

## 5. Executor (`index.ts` — public API)

The main entry point that ties everything together.

```typescript
interface MigrateOptions {
  /** Session with OCC retry logic */
  session: Session;
  /** The serialized local schema (array of toJSON() outputs) */
  schema: unknown[]; // the JSON array from schema serialization
  /** If true, only return the plan without executing */
  dryRun?: boolean;
}

interface MigrateResult {
  /** Operations that were executed (or would be, in dry-run) */
  operations: MigrationOp[];
  /** Warnings for unsupported changes */
  warnings: string[];
  /** Index job IDs that were awaited */
  indexJobs: { indexName: string; jobId: string; status: string }[];
}

async function migrate(options: MigrateOptions): Promise<MigrateResult>;
```

### Execution flow

```ts
async function migrate({ session, schema, dryRun }):

  // 1. Introspect current DB state
  dbSchema = await introspect(session)

  // 2. Diff local vs DB
  plan = diff(schema, dbSchema)

  // 3. Log warnings
  for warning of plan.warnings:
    console.warn("[migrate]", warning)

  if dryRun:
    return { operations: plan.operations, warnings: plan.warnings, indexJobs: [] }

  // 4. Execute DDL operations one-per-transaction
  indexJobs = []
  for op of plan.operations:
    sql = generateDDL(op)
    result = await session.execute({ text: sql, params: [] })

    // CREATE INDEX ASYNC returns a job_id
    if op.type === "create_index" and result has job_id:
      indexJobs.push({ indexName: op.index.name, jobId: result.job_id, status: "submitted" })

  // 5. Wait for all async index jobs
  for job of indexJobs:
    await session.execute({
      text: `SELECT sys.wait_for_job($1)`,
      params: [job.jobId]
    })
    // Check final status
    statusResult = await session.execute({
      text: `SELECT status, details FROM sys.jobs WHERE job_id = $1`,
      params: [job.jobId]
    })
    job.status = statusResult[0]?.status ?? "unknown"

    if job.status === "failed":
      // Drop the invalid index
      await session.execute({
        text: `DROP INDEX IF EXISTS "${job.indexName}"`,
        params: []
      })
      throw new Error(`Index creation failed for ${job.indexName}: ${statusResult[0]?.details}`)

  return { operations: plan.operations, warnings: plan.warnings, indexJobs }
```

### Transaction handling

Each DDL statement runs as its own implicit transaction. Since DSQL auto-commits DDL in its own transaction anyway, and we can't mix DDL with anything else, we just execute each statement directly via `session.execute()`. The session's OCC retry logic handles `40001`/`OC001` errors transparently.

We don't need explicit `BEGIN/COMMIT` wrapping for DDL — DSQL handles that. We only need the retry logic on the session.

---

## Integration with the test suite

For the existing PGlite-based tests, the migrator won't fully work because PGlite doesn't support `CREATE INDEX ASYNC` or `sys.jobs`. The existing test approach of applying raw SQL migrations (`schema_create.sql`) can stay for unit tests.

For integration testing against a real DSQL instance, we'd use the migrator directly:

```typescript
const result = await migrate({
  session: dsqlSession, // real DSQL session with retry logic
  schema: Object.values(schema).map((def) => def.toJSON()),
});
```

---

## Open questions

1. **Index columns on serialized schema** — We need to extend `IndexDefinition` to store and serialize column names. This is a prerequisite for the migrator to generate `CREATE INDEX` statements. Should we tackle this as part of the migration work, or as a separate PR first?

2. **Default values** — `ColumnDefinition` has `_defaultValue`, `_onCreate`, `_onUpdate` but `toJSON()` doesn't serialize defaults. For `CREATE TABLE`, we'd want to include `DEFAULT` clauses. However, `_onCreate`/`_onUpdate` are JS callbacks (e.g., `() => new Date()`), not SQL expressions. Do we need a separate `sqlDefault` concept, or do we rely on DB-level defaults being set manually?

3. **Schema name** — Currently everything assumes `public` schema. The schema definitions have a `SchemaDefinition` class that's optional on tables. For MVP, hardcoding `public` is fine, but worth noting.

4. **Dry-run output format** — Should `dryRun` return the raw SQL strings as well as the operation objects? Useful for reviewing what would run.

5. **`sys.wait_for_job` behavior** — The docs say it "blocks the current session until the specified job completes or fails." Need to verify: does it return a boolean, throw on failure, or just return? This affects error handling.
