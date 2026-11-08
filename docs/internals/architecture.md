# Architecture

_Audience: contributors and agents._

`dsqlbase` is an npm-workspaces + Turborepo monorepo with four workspaces under `packages/`. Use `npm` / `npx` only (`yarn` and `pnpm` are blocked via `engines`). Developing in the repo needs Node `>=24.14.1` and npm `>=11.11.0`; the published packages need Node `>=22` (their `engines`). ESM only (`"type": "module"`, `module: "nodenext"`).

## Workspaces and dependency direction

```
@dsqlbase/core  ←  dsqlbase            (schema builders, client, pg/pglite sessions)
@dsqlbase/core  ←  @dsqlbase/migration (introspection, reconciliation, DDL, runner)
                   @dsqlbase/tests     (private; devDeps on all of the above)
```

`dsqlbase` and `@dsqlbase/migration` do **not** depend on each other. A consumer installs `dsqlbase` for runtime and `@dsqlbase/migration` separately for migrations. All three published packages are version-locked through the changeset `fixed` group (`.changeset/config.json`).

## `@dsqlbase/core` — primitives (`packages/core/src/`)

Sub-entrypoints `./definition`, `./resolvers`, `./validation`, `./runtime`, `./sql`, `./utils`, all re-exported from the root. Dependencies run one way: `definition` ← `validation` ← `runtime`, bridged by `resolvers`.

- **`definition/`** — the abstract, dialect-agnostic schema model: `TableDefinition`, `ColumnDefinition`, `RelationsDefinition`, `UnionDefinition` (`union.ts`; a set of member tables and the shared fields it declares, each resolved to the same column on every member, with no DDL), `IndexDefinition`, `DomainDefinition`, `SequenceDefinition`, `NamespaceDefinition`, `ViewDefinition` (a stub). Concrete column types live in `dsqlbase`. `TableDefinition._constraints` holds table-level PK/UNIQUE/CHECK; there is no foreign-key constraint type yet. `TableDefinition._policies` holds row policies (`.policy()`), which never reach `toJSON`. `settings.ts` declares per-request settings (`SettingsDefinition`, one `SettingDefinition` per key under `settings`), which are not schema objects.
- **`resolvers/`** — the contracts declared on a definition but run by the runtime: `ColumnCodec` (pure, one value — a definition runs it for a DDL default), `ColumnValidator` (checks writes and reads, never filters) `ColumnHooks` (`read` / `write` around the codec, handed the runtime column and, on a read, the row) and `PolicyResolver` (`policy.ts`: a row policy's callback over the runtime columns). Typed with the runtime classes, so it is the one place `definition` and `runtime` meet; see [Codec boundary](./codec-boundary.md#column-hooks).
- **`validation/`** — `validateSchema`, pure checks over a `DefinitionSchema` before anything is built: relation pairs (including that both sides carry the same column hooks), discriminators, field-name collisions, union aliases, and what columns reference (`references.ts`: no ring, and a column with hooks references one target, reached in every union member through a unique key). It reads definitions only and keeps nothing; definitions themselves do not validate the schema as a whole. Also `collectRelations`, the relations each table receives (a union's, once per member), which `runtime` builds from.
- **`runtime/`** — what a client uses at query time: `SchemaRegistry` (lookups over a built schema: runtime `Table` / `Column` instances keyed by both alias and table name, `Union` instances (`union.ts`) keyed by alias, and resolved relations via `getRelation`. It runs `validateSchema` (`validation/validate.ts`, pure checks over definitions) then `buildSchema` (`build.ts`, which builds the runtime objects and records each relation on its foreign-key columns as `Column.references`) — see [Relations and joins](./runtime-pipeline.md#relations-and-joins)), `ExecutionContext` (`{ session, dialect, schema, operations, settings?, policies }`), `OperationsFactory` (insert/select/update/delete shapes, column resolution, result resolvers, row-policy predicates and checks), `RuntimePolicy` (`policy.ts`, a policy resolved on its `Table`), `PolicyViolationError` (`errors.ts`, decoded by `ExecutableQuery`), `QueryBuilder` (SQL text), `ExecutableQuery`, and the `Session` / `TransactionSession` interfaces consumers implement (`session.ts`).
- **`sql/`** — the `sql` tagged template (`tag.ts`), AST nodes (`SQLQuery`, `SQLParam`, `SQLRaw`, `SQLIdentifier`, `SQLWrapper`, and `SQLSetting` — a per-request value bound from `SQLContext.settings` — in `nodes.ts`), comparison helpers (`sql.eq`, `sql.in`, …). `SQLStatement` is the `{ text, params }` shape sessions execute.

## `dsqlbase` — the public package (`packages/dsqlbase/src/`)

Entrypoints: `.`, `./schema`, `./client`, `./pg`, `./pglite`.

- **`schema/`** — user-facing builders: one file per column type under `columns/`, plus `table.ts`, `union.ts` (`union`), `relations.ts` (`relations`, which accepts a union source, and `hasMany` / `hasOne` / `belongsTo`, each of which accepts a union target), `domain.ts` (`domain`, `$enum`), `sequence.ts`, `namespace.ts`, `settings.ts` (`settings`), and `utils/` — value formatters the codecs are built from (`duration.ts`, `date.ts`, `global-id.ts`), the hooks every `guid()` carries (`guid-hooks.ts`), plus the vendored Standard Schema types and `ColumnValidationError` that `.schema()` validates with (`standard-schema.ts`, `column-validation.ts`). Each column wraps a `core` `ColumnDefinition` with PG-specific options and a codec.
- **`client/`** — `create.ts` builds `SchemaRegistry` + `QueryBuilder` + `ExecutionContext` and attaches one `ModelClient` per table as a non-writable property on a `DatabaseClient`. `model/base.ts` holds the `QueryArgs` types and their JSDoc; `model/client.ts` the `findOne` / `findMany` / `create` / `update` / `delete` / `updateMany` / `deleteMany` methods; `model/normalizer.ts` turns args into operation args, and `model/filters.ts` holds the `where` language — the runtime-type operator table, the filter types and the `WhereBuilder` the normalizer builds every `where` with. `database/base.ts` exposes `$query(SQLQuery)` and `$execute(SQLStatement)`. `union/client.ts` is the read-only `UnionClient` (`findOne` / `findMany` / `paginate` / `count`), attached by the same `attachModels` under each union's alias. `transaction/` implements `$transaction` and OCC retry.
- **`client/nodes.ts`** finds the node tables when `createClient` runs: which tables a global id can address, and by which unique keys. What each `guid()` column's values name is read by its hooks (`schema/utils/guid-hooks.ts`) from the references `core` sets, and the shapes a guid cannot live with are refused by `core`'s `validateSchema` as generic rules on column hooks. Global ids live in `dsqlbase` rather than in `core`, which has no opinion about the shape of an id — see [0007](../decisions/0007-global-ids.md).
- **Two derived clients, one mechanism.** A transaction client swaps the context's `session`; a settings client (`DatabaseClient.$settings`) sets its `settings`. Both build a fresh `ExecutionContext` from the parent's and re-attach models through `attachModels`, so they compose: settings (merged on each call), then transact. Settings change only the values statements bind; a client with them has the same methods as one without. Every table is on every client; what a client may read or write is decided by row policies in `core`'s operations factory — see [0024](../decisions/0024-row-policies.md).
- **`pg/`**, **`pglite/`** — `Session` implementations over `pg.Pool` and `PGlite`, each with `beginTransaction()`.

The root `index.ts` re-exports `createClient`, `sql`, `SQLQuery`, `PolicyViolationError`, and the `Session` / `SQLStatement` types.

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
