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
import { createMigrationRunner, getSerializedSchemaObjects } from "@dsqlbase/migration";
import { createPgSession } from "dsqlbase/pg";
import * as schema from "./schema";

const runner = createMigrationRunner(createPgSession(pool));
const definitions = getSerializedSchemaObjects(Object.values(schema));

const statements = await runner.dryRun(definitions);          // printed SQL, nothing executed
const { operations, errors, destructive } = await runner.plan(definitions);
await runner.run(definitions, { destructive: false });
```

| Method | IO | Returns |
|---|---|---|
| `validate(definition)` | none | validation errors and warnings |
| `introspect()` | one query | `SerializedSchema` of the live database |
| `reconcile(local, remote, options)` | none | ordered operations + refusals |
| `plan(definition, options)` | introspect | `{ operations, errors, destructive }`; throws `MigrationError` on validation failure |
| `dryRun(definition, options)` | introspect | `SQLStatement[]`; throws on refusals or ungated destructive ops |
| `run(definition, options)` | full | executes sequentially; same gates as `dryRun` |

`getSerializedSchemaObjects` accepts the module's exported values and keeps only tables, domains, sequences, and namespaces (relations are ignored — see [Relations](./relations.md)).

### Options

| Option | Default | Effect |
|---|---|---|
| `destructive` | `false` | Required to run any `DROP`. Without it `run`/`dryRun` throw when the plan contains drops. |
| `asyncIndexes` | `true` | Emit `CREATE INDEX ASYNC` (required on DSQL). Set `false` for PGlite / plain Postgres. |
| `safeOperations` | `false` | Adds `IF [NOT] EXISTS` where applicable. Also switches drops to `CASCADE`; the name is misleading and this flag is under review. |

The repo's e2e suite runs `{ asyncIndexes: false, destructive: true, safeOperations: true }` against PGlite: `packages/tests/src/db/migrate.ts`.

## Refusals

Changes DSQL cannot express (or that the module does not model yet) come back as refusals in `plan().errors` rather than being silently skipped: a structured record with a `code` (`IMMUTABLE_COLUMN`, `NO_DROP_COLUMN`, `IMMUTABLE_CONSTRAINT`, …), the subject, and the blocked diffs. `run` and `dryRun` throw when any refusal is present. Several current refusals are stricter than DSQL requires; the capability table tracks which.

## Deployment

The runner exposes primitives (`validate` / `introspect` / `reconcile` / `plan`) so that a durable host — a CloudFormation custom resource, a CI job — can drive them with its own retry and observability. A CDK construct and a CLI are planned, not shipped.

## Related

- [Schema](./schema.md)
- [DSQL notes](./dsql-notes.md)
- [Migration pipeline (internals)](../internals/migration-pipeline.md)
- [DSQL capabilities (internals)](../internals/dsql-capabilities.md)
