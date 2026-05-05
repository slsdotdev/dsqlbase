# @dsqlbase/schema

Concrete column types, schema-object builders, and the migration pipeline for the dsqlbase toolkit.

> [!NOTE]
> This is an internal package within the [dsqlbase](https://github.com/slsdotdev/dsqlbase) monorepo. The schema-definition surface is re-exported from [`dsqlbase/schema`](https://www.npmjs.com/package/dsqlbase) — most users should depend on `dsqlbase` instead. Depend on `@dsqlbase/schema` directly when you need the migration tooling, which currently isn't re-exported by the meta-package.

## Install

```bash
npm install @dsqlbase/schema
```

For schema definition only, `npm install dsqlbase` and import from `dsqlbase/schema`. Install `@dsqlbase/schema` directly if you need to import from `@dsqlbase/schema/migration`.

## License

MIT.
