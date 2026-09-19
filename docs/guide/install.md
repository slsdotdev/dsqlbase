# Install

_Audience: application developers._

## Requirements

- Node `>=24.14.1`, npm `>=11.11.0`.
- ESM only. Every package ships `"type": "module"`; import with ESM syntax.

## Application (Aurora DSQL)

```bash
npm install dsqlbase @aws/aurora-dsql-node-postgres-connector pg
npm install --save-dev @types/pg
```

`dsqlbase` depends on `@dsqlbase/core` and pulls it in for you. `pg` is a peer dependency used by the `dsqlbase/pg` session; the Aurora DSQL connector provides an IAM-authenticating `Pool` (see [Sessions](./sessions.md)).

## Local development and tests (PGlite)

```bash
npm install --save-dev @electric-sql/pglite
```

`@electric-sql/pglite` is a peer dependency used by the `dsqlbase/pglite` session. It runs Postgres in-process, which is how this repo's own end-to-end tests run (`packages/tests`).

## Migrations

```bash
npm install @dsqlbase/migration
```

The migration runner is a separate published package; `dsqlbase` does not depend on it. See [Migrations](./migrations.md).

## Related

- [Guide index](./README.md)
- [Sessions](./sessions.md)
