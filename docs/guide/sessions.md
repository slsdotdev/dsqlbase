# Sessions

_Audience: application developers._

A `Session` is the only thing `dsqlbase` needs from your database driver. There is no built-in connection management: the session runs statements, and opens transactions if it can.

```ts
type Session = {
  execute<T = unknown>(query: SQLStatement): Promise<T[]>;
  beginTransaction?(): Promise<TransactionSession>;   // required for $transaction
};

type TransactionSession = Session & {
  commit(): Promise<void>;
  rollback(): Promise<void>;
};
```

Source: `packages/core/src/runtime/session.ts`.

## Provided sessions

| Import | Factory | Backing driver | Use |
|---|---|---|---|
| `dsqlbase/pg` | `createPgSession(pool)` | `pg` `Pool` | production; pair with `AuroraDSQLPool` from `@aws/aurora-dsql-node-postgres-connector` for IAM auth |
| `dsqlbase/pglite` | `createPgLiteSession(pglite)` | `@electric-sql/pglite` | tests and local development |

```ts
import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import { createPgSession } from "dsqlbase/pg";

const session = createPgSession(new AuroraDSQLPool({ host: process.env.DSQL_ENDPOINT }));
```

Sources: `packages/dsqlbase/src/pg/index.ts`, `packages/dsqlbase/src/pglite/index.ts`. The repo's own reference wiring is `packages/tests/src/db/client.ts`.

### `pg`

A statement outside a transaction runs on the pool (`pool.query`), which picks any free connection. A transaction takes one connection from the pool for its whole life and returns it when it ends:

- `BEGIN` fails → the connection goes back to the pool and the error is thrown.
- `commit()` → `COMMIT`, and the connection goes back to the pool. A `COMMIT` that fails — DSQL reports a conflict here, as `40001` — throws, and the connection still goes back.
- `rollback()` → `ROLLBACK`, and the connection goes back. It never throws: it runs after another error, which is the one you need.
- A connection that broke (the error has no SQLSTATE) is destroyed rather than returned, so the pool never hands it out again; destroying it also ends the transaction on the server.

Each connection is returned exactly once. After `commit()` or `rollback()`, the other is a no-op.

### PGlite

A PGlite instance is a single connection. While a transaction is open, every query on the instance runs inside it — including one made outside `$transaction` — so don't share an instance between concurrent work that expects isolation. It suits tests and local development; the repo's end-to-end suite runs on it.

## Bringing your own session

Any object of the `Session` shape works — a different driver, or a wrapper that adds logging or tracing around a provided session:

```ts
import type { Session } from "@dsqlbase/core";

const traced = (inner: Session): Session => ({
  async execute(query) {
    const started = performance.now();
    try {
      return await inner.execute(query);
    } finally {
      log.debug({ sql: query.text, ms: performance.now() - started });
    }
  },
  beginTransaction: inner.beginTransaction?.bind(inner),
});
```

Log `query.text`, not `query.params`: parameters are row data.

A session that implements `beginTransaction` should keep the contract the provided ones keep, since `$transaction` relies on it:

- `commit` and `rollback` each end the transaction and free what it holds, whether they succeed or not; after either, the other is a no-op.
- `commit` throws what the database answered, unchanged. `$transaction` retries an error whose `code` is `"40001"`, so keep the driver's `code`.
- `rollback` doesn't throw. If it does anyway, `$transaction` ignores it and throws the error that caused the rollback.

## Related

- [Transactions](./transactions.md)
- [Querying](./querying.md)
- [Install](./install.md)
- [DSQL notes](./dsql-notes.md)
