# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`dsqlbase` is an ORM and migration toolkit for AWS Aurora DSQL (PostgreSQL-compatible). It is an npm-workspaces + Turborepo monorepo. Use `npm` / `npx` only — `yarn` and `pnpm` are blocked via `engines`.

Node `>=24.14.1`, npm `>=11.11.0`. ESM only (`"type": "module"`, `module: "nodenext"`).

## Common commands

Run from the repo root (Turbo fans them out across workspaces):

| Command | Purpose |
|---|---|
| `npm run build` | `tsc` build all packages (respects `^build` deps). |
| `npm run dev` | `tsc --watch` across packages. |
| `npm test` | Vitest in every package. |
| `npm run lint` | ESLint across packages. Runs automatically via Husky pre-commit. |
| `npm run coverage` | Vitest with `--coverage` (v8). |
| `npm run changeset` / `npm run publish` | Versioning + publishing via Changesets. |

Per-package work — `cd packages/<pkg>` then:

- `npm test` — run that package's Vitest suite.
- `npx vitest run path/to/file.test.ts` — single file.
- `npx vitest run -t "name of test"` — single test by name.
- `npx vitest dev` — watch mode (`packages/schema` exposes this as `npm run test:watch`).
- `packages/client` runs `vitest run --typecheck` — type-level tests are part of the suite.
- `packages/tests` is private and runs E2E specs via `npm run test:e2e` (against PGlite, not real DSQL).

## Architecture

Five workspaces under `packages/`. Dependency direction: `core` ← `schema` ← `client` ← `dsqlbase`; `tests` consumes the others as devDeps.

### `@dsqlbase/core` — primitives

Three sub-entrypoints (`./definition`, `./runtime`, `./sql`, `./utils`) re-exported from the root.

- **`definition/`** — abstract schema model (`TableDefinition`, `ColumnDefinition`, `RelationsDefinition`, `IndexDefinition`, `DomainDefinition`, `SequenceDefinition`, `ViewDefinition`, `NamespaceDefinition`). These are dialect-agnostic; concrete column types live in `schema`.
- **`runtime/`** — what a client actually uses at query time: `SchemaRegistry` (resolves a `DefinitionSchema` into runtime `Table`/`Column` instances), `ExecutionContext` (binds schema + dialect + `Session`), `OperationsFactory` (insert/select/update/delete shapes), `QueryBuilder`, `ExecutableQuery`, and the `Session` / `TransactionSession` interfaces consumers implement.
- **`sql/`** — `sql` tagged-template builder, AST nodes (`SQLNode`, `SQLQuery`, `SQLParam`, `SQLRaw`, `SQLIdentifier`, `SQLWrapper`), and helpers. `SQLStatement` is the `{ text, params }` shape sessions execute.

### `@dsqlbase/schema` — concrete types + migrations

Two sub-entrypoints: `./definition` and `./migration`.

- **`definition/`** — user-facing column constructors (`text`, `uuid`, `int`, `timestamp`, `json`, `array`, …), plus `table()`, `relations()`, `hasMany`/`hasOne`/`belongsTo`, `domain()`, `sequence()`, `namespace()`. Each column wraps a `core` `ColumnDefinition` with PG-specific options.
- **`migration/`** — pipeline for generating DDL from a definition schema:
  - `introspection/` — `introspection` query + `normalizer` that turn live PG `information_schema` rows into a `SerializedSchema`.
  - `reconciliation/reconcile.ts` — diffs a target `DefinitionSchema` against a `SerializedSchema` to produce ordered change operations.
  - `ddl/` — `ast.ts` describes statement nodes, `factory.ts` builds them, `printer.ts` renders SQL, `schema.ts` orchestrates print-from-schema. `STATEMENT_BREAKPOINT` separates batched statements.
  - `validation/` — pre-flight checks against a definition schema.
  - `runner.ts` / `executor.ts` — applies generated DDL via a `Session`.
  - `base.ts` exports `ORDERED_SCHEMA_OBJECTS`, `sortSchemaObjects`, and the `SerializedSchema` types — order matters for both DDL emission and reconciliation.

### `@dsqlbase/client` — query client

`createClient({ schema, session })` returns a `DSQLClient<TSchema>` = `DatabaseClient & Models<TSchema>`. The factory builds a `SchemaRegistry` + `QueryBuilder` + `ExecutionContext`, then attaches one `ModelClient` per table as a non-writable property on the `DatabaseClient`. Models surface `create` / `find` / `update` / `delete`-style methods; `model/normalizer.ts` handles row → object shaping. `QueryClient` (the `DatabaseClient` base) exposes `$execute(SQLStatement)` and `$raw(SQLQuery)` escape hatches.

A consumer must supply a `Session` (`execute<T>(query: SQLStatement): Promise<T[]>`). There is no built-in connection management — `packages/tests/src/db/client.ts` shows the PGlite reference implementation.

### `dsqlbase` — public meta-package

Currently only a placeholder (`src/index.ts` re-exports nothing). Real entry surface lives in the scoped packages.

### `@dsqlbase/tests` — E2E

Private workspace. Uses `@electric-sql/pglite` as an in-process Postgres to exercise the full schema → client stack. `src/db/schema.ts` is the canonical multi-table fixture (users/teams/members/projects/tasks). Tests under `src/specs/` are the closest thing to integration tests against a real DSQL.

## Conventions

- **TS config**: root `tsconfig.json` is `noEmit` strict ESNext + `nodenext`; package configs extend it and emit to `dist/`. Imports use explicit `.js` extensions even from `.ts` (required by `nodenext`).
- **ESLint flat config** at the root applies `tseslint` strict + stylistic to every package; there is no per-package config.
- **Husky pre-commit** runs `npm run lint`. Don't bypass it.
- **Changesets** govern versioning — when changing a published package, add a changeset (`npm run changeset`) rather than bumping `version` by hand.
- **Proposals**: design docs live in `.claude/proposals/` and are written before non-trivial implementation work.
