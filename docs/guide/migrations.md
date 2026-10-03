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
| `action` | `CREATE`, `ADD`, `ALTER`, `DROP`, `RENAME`, `VALIDATE`, `BACKFILL` |
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

## Columns on existing tables

DSQL's `ADD COLUMN` takes no attributes at all — not even a `DEFAULT` — and there is no `SET NOT NULL` or `SET DATA TYPE`. The runner builds each change from what DSQL does allow:

| Change | Steps | Risk |
|---|---|---|
| Add a column | `ADD COLUMN` | safe |
| …with a default | then `SET DEFAULT` — **existing rows stay `NULL`**; only new rows get it | safe |
| …`NOT NULL`, with a default | then a **backfill** (existing rows get the default), then `CHECK (c IS NOT NULL)` added `NOT VALID` and validated | safe |
| …`NOT NULL`, no default | refused (`NOT_NULL_NEEDS_DEFAULT`): its existing rows would be `NULL` | — |
| Make a column `NOT NULL` | backfill if it has a default, then the `CHECK`; without a default, validation fails while a `NULL` is left | safe |
| Drop a `NOT NULL` | `DROP NOT NULL`, or `DROP CONSTRAINT` for one made by a `CHECK` | lossy |
| Set, change or drop a default | `SET DEFAULT` / `DROP DEFAULT` | safe / lossy |
| Drop a column | `DROP COLUMN` (its indexes and constraints go with it) | **destructive** |
| Change a column's type | `DROP COLUMN`, `ADD COLUMN`, then its default, `NOT NULL` and the indexes and constraints that involved it — **its data is lost** | **destructive** |
| Generated column → plain | `DROP EXPRESSION` (values kept; it can't be made generated again) | **destructive** |
| Identity options, mode | `SET INCREMENT BY …`, `SET START WITH …`, `SET GENERATED …` — never `RESTART` | safe (narrower bounds: lossy) |

A **backfill** is `UPDATE … SET c = DEFAULT` on 1,000 rows at a time, each batch its own transaction (DSQL writes at most 3,000 rows per transaction), repeated until no `NULL` is left. A batch that conflicts with a concurrent write is retried; it only fills `NULL`s, so it is safe to run again. It takes a while on large tables.

A `NOT NULL` added to an existing table is a `CHECK (c IS NOT NULL)` named `<table>_<column>_not_null` — it enforces the same — and the runner reads it back as the column's `NOT NULL`.

To change a type **and keep the data**, don't let the runner drop the column: add a new column with the new type, copy the values, switch the code over, then `.deprecated()` the old one and remove it in a later release. A destructive step's note in the plan, and the error when it isn't allowed, say so.

Refused, with the reason in the plan: adding a generated or identity column, making an existing column generated or an identity (an identity needs a `NOT NULL` from `CREATE TABLE`), changing a generated expression, and dropping or retyping a primary-key column.

## Constraints and indexes on existing tables

- **CHECK** — added `NOT VALID`, then validated against the existing rows by an async job (`ALTER TABLE ASYNC … VALIDATE CONSTRAINT`). It is enforced on new writes from the first step. If an existing row violates it, validation fails, the run stops with the database's message, and the constraint **stays** — enforced, but not valid. Fix the data and run again: the next plan is just the `VALIDATE`. A removed CHECK is dropped (lossy).
- **UNIQUE** — a unique index is built asynchronously, then promoted to the constraint. A removed one is dropped together with its index (lossy); a changed one is dropped and built again.
- **Indexes** — a changed index is rebuilt: dropped (lossy), then created; it is unavailable in between. So is an index whose async build failed.
- **Primary keys** can't be added, dropped or changed: DSQL fixes them at `CREATE TABLE`.

A constraint compares the same whether it was declared on a column (`.unique()`, `.check()`, `.primaryKey()`) or on the table: PostgreSQL doesn't record the difference. A CHECK and a UNIQUE are matched by name — a column's `.unique()` is the constraint PostgreSQL names `<table>_<column>_key` — so renaming one drops it and adds the new one. CHECK expressions aren't compared yet: change a CHECK by renaming it.

Async jobs take time on DSQL even for small tables: 10–30 s per index build or validation was typical when measured.

## Refusals

Changes DSQL cannot express come back as refusals in `plan().errors` — and as `REFUSED` rows — rather than being silently skipped: a structured record with a `code`, the subject, the blocked diffs, and a message saying what to do instead. `run` and `dryRun` throw when any refusal is present.

| Code | Refused |
|---|---|
| `NOT_NULL_NEEDS_DEFAULT` | adding a `NOT NULL` column without a default |
| `NO_ADD_GENERATED_COLUMN` | adding a generated column |
| `NO_ADD_IDENTITY` | adding an identity column, or making an existing column one |
| `NO_ALTER_GENERATED` | making a column generated, or changing its expression |
| `NO_ALTER_PRIMARY_KEY_COLUMN`, `NO_DROP_PRIMARY_KEY_COLUMN` | retyping or dropping a primary-key column |
| `IMMUTABLE_CONSTRAINT` | adding, dropping or changing a primary key |
| `IMMUTABLE_DOMAIN` | changing a domain's type, `NOT NULL` or `CHECK` |
| `KIND_MISMATCH` | an object whose kind changed under the same name |

A [column group](./embeddable-objects.md) is plain columns to the migration module: changing an
embedded object adds or drops its members' columns in every table that embeds it, and is planned
— or refused — exactly as those column changes would be. A required member added to an existing
shape needs a default, which fills the existing rows.

## Deployment

The runner exposes primitives (`validate` / `introspect` / `reconcile` / `plan`) so that a durable host — a CloudFormation custom resource, a CI job — can drive them with its own retry and observability. A CDK construct and a CLI are planned, not shipped.

## Related

- [Schema](./schema.md)
- [DSQL notes](./dsql-notes.md)
- [Migration pipeline (internals)](../internals/migration-pipeline.md)
- [DSQL capabilities (internals)](../internals/dsql-capabilities.md)
