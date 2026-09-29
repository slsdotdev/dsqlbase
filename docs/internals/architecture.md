# Architecture

_Audience: contributors and agents._

`dsqlbase` is an npm-workspaces + Turborepo monorepo with four workspaces under `packages/`. Use `npm` / `npx` only (`yarn` and `pnpm` are blocked via `engines`). Node `>=24.14.1`, npm `>=11.11.0`, ESM only (`"type": "module"`, `module: "nodenext"`).

## Workspaces and dependency direction

```
@dsqlbase/core  ←  dsqlbase            (schema builders, client, pg/pglite sessions)
@dsqlbase/core  ←  @dsqlbase/migration (introspection, reconciliation, DDL, runner)
                   @dsqlbase/tests     (private; devDeps on all of the above)
```

`dsqlbase` and `@dsqlbase/migration` do **not** depend on each other. A consumer installs `dsqlbase` for runtime and `@dsqlbase/migration` separately for migrations. All three published packages are version-locked through the changeset `fixed` group (`.changeset/config.json`).

## `@dsqlbase/core` — primitives (`packages/core/src/`)

Sub-entrypoints `./definition`, `./runtime`, `./sql`, `./utils`, all re-exported from the root.

- **`definition/`** — the abstract, dialect-agnostic schema model: `TableDefinition`, `ColumnDefinition`, `RelationsDefinition`, `UnionDefinition` (`union.ts`; a set of member tables and their shared fields, with no DDL), `IndexDefinition`, `DomainDefinition`, `SequenceDefinition`, `NamespaceDefinition`, `ViewDefinition` (a stub). Concrete column types live in `dsqlbase`. `TableDefinition._constraints` holds table-level PK/UNIQUE/CHECK; there is no foreign-key constraint type yet.
- **`runtime/`** — what a client uses at query time: `SchemaRegistry` (resolves a `DefinitionSchema` into runtime `Table` / `Column` instances, keyed by both alias and table name, and `Union` instances (`union.ts`) keyed by alias; it validates every relation, including per-member pairs and the discriminator of a relation to a union), `ExecutionContext` (`{ session, dialect, schema, operations }`), `OperationsFactory` (insert/select/update/delete shapes, column resolution, result resolvers), `QueryBuilder` (SQL text), `ExecutableQuery`, and the `Session` / `TransactionSession` interfaces consumers implement (`session.ts`).
- **`sql/`** — the `sql` tagged template (`tag.ts`), AST nodes (`SQLQuery`, `SQLParam`, `SQLRaw`, `SQLIdentifier`, `SQLWrapper` in `nodes.ts`), comparison helpers (`sql.eq`, `sql.in`, …). `SQLStatement` is the `{ text, params }` shape sessions execute.

## `dsqlbase` — the public package (`packages/dsqlbase/src/`)

Entrypoints: `.`, `./schema`, `./client`, `./pg`, `./pglite`.

- **`schema/`** — user-facing builders: one file per column type under `columns/`, plus `table.ts`, `union.ts` (`union`), `relations.ts` (`hasMany` / `hasOne` / `belongsTo`, each of which accepts a union target), `domain.ts` (`domain`, `$enum`), `sequence.ts`, `namespace.ts`, `tenant.ts` (`tenantScope`), and `utils/` — value formatters the codecs are built from (`duration.ts`, `date.ts`, `json.ts`, `global-id.ts`). Each column wraps a `core` `ColumnDefinition` with PG-specific options and a codec.
- **`client/`** — `create.ts` builds `SchemaRegistry` + `QueryBuilder` + `ExecutionContext` and attaches one `ModelClient` per table as a non-writable property on a `DatabaseClient`. `model/base.ts` holds the `QueryArgs` types and their JSDoc; `model/client.ts` the `findOne` / `findMany` / `create` / `update` / `delete` methods; `model/normalizer.ts` turns args into SQL nodes. `database/base.ts` exposes `$query(SQLQuery)` and `$execute(SQLStatement)`. `union/client.ts` is the read-only `UnionClient` (`findOne` / `findMany` / `paginate` / `count`), attached by the same `attachModels` under each union's alias. `transaction/` implements `$transaction` and OCC retry.
- **`client/nodes.ts`** resolves every `guid()` column against the whole schema when `createClient` runs: which tables are nodes, what each column's values name, and the bound codec that wraps them. Global ids live here rather than in `core`, which has no opinion about the shape of an id — see [0007](../decisions/0007-global-ids.md).
- **Two derived clients, one mechanism.** A transaction client swaps the context's `session`; an identity client (`DatabaseClient.$identityClaims`) sets its `identity`. Both build a fresh `ExecutionContext` from the parent's and re-attach models through `attachModels`, so they compose in one direction: scope, then transact. Which tables a derived client may address is a property of its _type_ (`database/index.ts`), while the runtime refusal lives in `core`'s operations factory — see [0005](../decisions/0005-tenant-client-visibility.md).
- **`pg/`**, **`pglite/`** — `Session` implementations over `pg.Pool` and `PGlite`, each with `beginTransaction()`.

The root `index.ts` re-exports `createClient`, `sql`, `SQLQuery`, `TenancyError`, and the `Session` / `SQLStatement` types.

## `@dsqlbase/migration` (`packages/migration/src/`)

Single entrypoint. Pipeline for generating and applying DDL from a definition:

- `introspection/` — `query.ts` (one `pg_catalog` round trip), `normalizer.ts` (rows → `SerializedSchema`), `introspect.ts`.
- `reconciliation/` — `diffs/` (attribute-level diffs, no DSQL knowledge), `operations/` (diffs → DDL operations or refusals; all DSQL policy lives here), `planner.ts` (topological ordering over `references[]`), `reconcile.ts` (entry point).
- `ddl/` — `ast.ts` statement nodes, `factory.ts` builders, `printer.ts` renderer, `schema.ts` print-from-definition. `STATEMENT_BREAKPOINT` separates batched statements.
- `validation/` — pre-flight rules over a definition (`rules/`, `validate.ts`).
- `runner.ts` / `executor.ts` — `MigrationRunner` (`validate` / `introspect` / `reconcile` / `plan` / `dryRun` / `run`) and the per-operation executor that detects async jobs by response shape and polls `sys.jobs`.
- `base.ts` — `ORDERED_SCHEMA_OBJECTS`, `sortSchemaObjects`, `getSerializedSchemaObjects`, `SerializedSchema` types, `MigrationError`.

Details: [Migration pipeline](./migration-pipeline.md).

## `@dsqlbase/tests` (`packages/tests/src/`)

Private. Runs end-to-end specs against `@electric-sql/pglite`. `db/schema/schema.ts` is the canonical multi-table fixture (teams / members / users / projects / tasks); `db/client.ts` and `db/migrate.ts` are the reference wiring. Specs live in `specs/`.

## Related

- [Runtime pipeline](./runtime-pipeline.md)
- [Conventions](./conventions.md)
- [Testing](./testing.md)
