# Migrations

_Audience: application developers._

The migration runner is **declarative**: it compares your schema definition with the live database and applies the DDL needed to make them match. There is no migration history table and no migration files. Source: `packages/migration/src/`, published as `@dsqlbase/migration`.

> **Status: partially stub.** The runner surface below is current. DSQL-specific behaviour (which changes are applied, refused, or need a workaround) is being revised against the current DSQL grammar; see [DSQL capabilities](../internals/dsql-capabilities.md) for the verified table.

## Pipeline

1. **Validate** — check the definition (missing primary keys, duplicate names, identifier length, reserved namespaces, sequence cache values, …).
2. **Introspect** — read the live database (`pg_catalog`) into the same serialized shape the definition produces.
3. **Reconcile** — diff live vs. definition; turn diffs into DDL operations or structured refusals.
4. **Plan** — order operations by their dependencies (schemas → domains → tables → indexes → constraints; drops reversed).
5. **Execute** — one statement per transaction, awaiting DSQL async jobs (`sys.jobs`) before moving on.

## Runner

```ts
import { createMigrationRunner, formatPlan, getSerializedSchemaObjects } from "@dsqlbase/migration";
import { createPgSession } from "dsqlbase/pg";
import * as schema from "./schema";

const runner = createMigrationRunner(createPgSession(pool));
const definitions = getSerializedSchemaObjects(Object.values(schema));

const statements = await runner.dryRun(definitions);          // printed SQL, nothing executed
const plan = await runner.plan(definitions);                  // operations, refusals, rows, risk
console.log(formatPlan(plan));                                // what would change, as a table
const result = await runner.run(definitions, { allow: { destructive: false } });
console.log(formatPlan(result));                              // the same rows, with each status
```

| Method | IO | Returns |
|---|---|---|
| `validate(definition)` | none | validation errors and warnings |
| `introspect()` | one query | `SerializedSchema` of the live database |
| `reconcile(local, remote, options)` | none | ordered operations + refusals |
| `plan(definition, options)` | introspect | `{ operations, errors, risk, rows }`; throws `MigrationError` on validation failure |
| `dryRun(definition, options)` | introspect | `SQLStatement[]`; throws on refusals, or steps whose risk `allow` doesn't cover |
| `run(definition, options)` | full | executes sequentially, stopping at the first failed step; same gates as `dryRun`; `{ count, progress, rows }` |

`getSerializedSchemaObjects` accepts the module's exported values and keeps only tables, domains, sequences, and namespaces (relations are ignored — see [Relations](./relations.md)).

### Reporting

A **change** is one difference on one target: a column, an index, a constraint. It runs as one or more **steps**, each a single statement in its own transaction. Adding a unique column, for example, takes three steps: add the column, build the unique index, promote it to a constraint.

`plan.rows` and `run().rows` hold one row per step, in execution order, then one per refused change:

| Field | Meaning |
|---|---|
| `step` | execution order, from 1 (`null` for a refusal) |
| `change`, `changeStep` | the change it belongs to, and its place in it (`"2/3"`) |
| `subject`, `subjectKind` | the table, domain, sequence or schema |
| `action` | `CREATE`, `ADD`, `ALTER`, `DROP`, `RENAME`, `VALIDATE` |
| `target`, `targetKind` | the column, index, constraint, identity, default or options changed |
| `changes` | `attribute: from → to`, `;`-separated |
| `risk`, `destructive` | `safe`, `lossy` (removes what redeploying restores: an index, a default), `destructive` (loses rows, or can't be re-created), or `refused` |
| `async` | runs as a DSQL async job (`CREATE INDEX ASYNC`) |
| `sql` | the statement |
| `refusal` | `{ code, message }` for a refused change |
| `blocked` | won't run under the `allow` the plan was made with (always `true` for a refusal) |
| `status`, `durationMs`, `error` | after `run` only; `status` is `completed`, `failed` or `skipped` (after a failed step) |

`formatPlan(planOrRows, { format: "text" | "markdown", sql?: boolean })` prints them:

```
#  Subject      Action        Target                      Changes         Risk   Async
-  -----------  ------------  --------------------------  --------------  -----  -----
1  table users  ADD (1/3)     column email                dataType: text  safe
2  table users  CREATE (2/3)  index users_email_key_idx   columns: email  safe   async
3  table users  ADD (3/3)     constraint users_email_key  unique: email   safe
4  table users  DROP          index users_nickname_idx                    lossy
```

### Options

| Option | Default | Effect |
|---|---|---|
| `allow.lossy` | `true` | Run `lossy` steps: removing what redeploying restores (an index, a default, a constraint, an identity). |
| `allow.destructive` | `false` | Run `destructive` steps: dropping tables, columns, sequences, domains or schemas, or removing what DSQL can't re-create. **Loses data.** |
| `asyncIndexes` | `true` | Emit `CREATE INDEX ASYNC` and `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` (required on DSQL). Set `false` for PGlite / plain Postgres. |
| `ifExists` | `true` | Adds `IF [NOT] EXISTS` to creates and drops. |

`safe` steps always run. `run` and `dryRun` throw a `MigrationError` when the plan has a refusal or a step whose risk `allow` doesn't cover; its `issues` name every such step (`DESTRUCTIVE_NOT_ALLOWED`, `LOSSY_NOT_ALLOWED`), and `plan(definition, { allow })` marks them `blocked` so a script can show them first. Drops are always `RESTRICT`: a `CASCADE` would remove objects the plan never listed, and DSQL refuses it for domains.

`run` stops at the first failed step and reports the rest as `skipped`. Every step is its own transaction, so the steps before it stay applied; the next run plans from the database as it then is, and resumes there.

The repo's e2e suite runs `{ asyncIndexes: false, ifExists: true, allow: { destructive: true } }` against PGlite: `packages/tests/src/db/migrate.ts`.

## Constraints and indexes on existing tables

- **CHECK** — added `NOT VALID`, then validated against the existing rows by an async job (`ALTER TABLE ASYNC … VALIDATE CONSTRAINT`). It is enforced on new writes from the first step. If an existing row violates it, validation fails, the run stops with the database's message, and the constraint **stays** — enforced, but not valid. Fix the data and run again: the next plan is just the `VALIDATE`. A removed CHECK is dropped (lossy).
- **UNIQUE** — a unique index is built asynchronously, then promoted to the constraint. A removed one is dropped together with its index (lossy); a changed one is dropped and built again.
- **Indexes** — a changed index is rebuilt: dropped (lossy), then created; it is unavailable in between. So is an index whose async build failed.
- **Primary keys** can't be added, dropped or changed: DSQL fixes them at `CREATE TABLE`.

A constraint compares the same whether it was declared on a column (`.unique()`, `.check()`, `.primaryKey()`) or on the table: PostgreSQL doesn't record the difference. A CHECK and a UNIQUE are matched by name — a column's `.unique()` is the constraint PostgreSQL names `<table>_<column>_key` — so renaming one drops it and adds the new one. CHECK expressions aren't compared yet: change a CHECK by renaming it.

Async jobs take time on DSQL even for small tables: 10–30 s per index build or validation was typical when measured.

## Refusals

Changes DSQL cannot express (or that the module does not model yet) come back as refusals in `plan().errors` rather than being silently skipped: a structured record with a `code` (`IMMUTABLE_COLUMN`, `NO_DROP_COLUMN`, `IMMUTABLE_CONSTRAINT`, …), the subject, and the blocked diffs. `run` and `dryRun` throw when any refusal is present. Several column refusals are stricter than DSQL requires; the capability table tracks which.

A [column group](./embeddable-objects.md) is plain columns to the migration module: changing an
embedded object adds or drops its members' columns in every table that embeds it, and is planned
— or refused — exactly as those column changes would be.

## Deployment

The runner exposes primitives (`validate` / `introspect` / `reconcile` / `plan`) so that a durable host — a CloudFormation custom resource, a CI job — can drive them with its own retry and observability. A CDK construct and a CLI are planned, not shipped.

## Related

- [Schema](./schema.md)
- [DSQL notes](./dsql-notes.md)
- [Migration pipeline (internals)](../internals/migration-pipeline.md)
- [DSQL capabilities (internals)](../internals/dsql-capabilities.md)
