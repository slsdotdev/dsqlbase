# Guide

_Audience: application developers using `dsqlbase`._

`dsqlbase` is a schema, query, and migration toolkit for [Aurora DSQL](https://aws.amazon.com/rds/aurora/dsql/). You describe tables in TypeScript, query them through a typed client, and reconcile the live database against the definition with the migration runner.

## Packages and entrypoints

| Import | What you get |
|---|---|
| `dsqlbase` | `createClient`, `sql`, `SQLQuery`, and the `Session` / `SQLStatement` types |
| `dsqlbase/schema` | Column builders, `table`, `relations`, `domain`, `$enum`, `sequence`, `namespace`, `tenantScope` |
| `dsqlbase/client` | Client classes and the `QueryArgs` family of types, for advanced typing |
| `dsqlbase/pg` | `createPgSession` for a `pg` `Pool` (production, via the Aurora DSQL connector) |
| `dsqlbase/pglite` | `createPgLiteSession` for `@electric-sql/pglite` (tests, local dev) |
| `@dsqlbase/migration` | `createMigrationRunner`, `validateDefinition`, `introspect`, `reconcileSchemas` |
| `@dsqlbase/core` | The primitives everything above is built on; only needed for tooling |

## Where to start

1. [Install](./install.md)
2. [Schema](./schema.md) and [Relations](./relations.md)
3. [Sessions](./sessions.md), then [Querying](./querying.md) and [Transactions](./transactions.md)
4. [Tenancy](./tenancy.md) — if rows belong to a workspace, organisation or account
5. [Migrations](./migrations.md)
6. [DSQL notes](./dsql-notes.md) — read before designing a schema for DSQL

> [!CAUTION]
> dsqlbase is in early-stage development. Features may change without notice; the [decisions log](../decisions/README.md) records why.
