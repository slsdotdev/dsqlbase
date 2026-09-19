# @dsqlbase/migration

Declarative schema migrations for the [dsqlbase](https://github.com/slsdotdev/dsqlbase) toolkit: validate a definition, introspect the live database, reconcile the two into ordered DDL, and apply it one statement per transaction while awaiting Aurora DSQL's async jobs.

> [!CAUTION]
> Early-stage; the public surface may change without notice.

## Install

```bash
npm install @dsqlbase/migration
```

## Documentation

- [Migrations guide](https://github.com/slsdotdev/dsqlbase/blob/main/docs/guide/migrations.md) — runner surface and options
- [Migration pipeline](https://github.com/slsdotdev/dsqlbase/blob/main/docs/internals/migration-pipeline.md) — internals
- [DSQL capabilities](https://github.com/slsdotdev/dsqlbase/blob/main/docs/internals/dsql-capabilities.md) — verified DDL table

## License

MIT.
