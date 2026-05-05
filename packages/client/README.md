# @dsqlbase/client

Query client for the dsqlbase toolkit — turns a schema definition into a typed model API backed by a user-supplied `Session`.

> [!NOTE]
> This is an internal package within the [dsqlbase](https://github.com/slsdotdev/dsqlbase) monorepo. Most users should depend on [`dsqlbase`](https://www.npmjs.com/package/dsqlbase) instead — it re-exports `createClient` and the related types. Depend on `@dsqlbase/client` directly only if you're building tooling that needs the client primitives without the rest of the meta-package.

## Install

```bash
npm install @dsqlbase/client
```

For typical application use, `npm install dsqlbase` instead.

## License

MIT.
