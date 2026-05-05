# @dsqlbase/core

Core primitives for the dsqlbase toolkit — abstract schema model, runtime types, and the `sql` tagged-template builder.

> [!NOTE]
> This is an internal package within the [dsqlbase](https://github.com/slsdotdev/dsqlbase) monorepo. Most users should depend on [`dsqlbase`](https://www.npmjs.com/package/dsqlbase) instead — it re-exports the public surface. Depend on `@dsqlbase/core` directly only if you're building tooling that needs the underlying primitives.

## Install

```bash
npm install @dsqlbase/core
```

For typical application use, `npm install dsqlbase` instead — it re-exports `sql`, `Session`, `SQLStatement`, and `SQLQuery` directly.

## License

MIT.
