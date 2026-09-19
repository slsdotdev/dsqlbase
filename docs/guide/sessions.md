# Sessions

_Audience: application developers._

> **Status: stub.** Full content lands with the client work. What is here is accurate but brief.

A `Session` is the only thing `dsqlbase` needs from your database driver. There is no built-in connection management.

```ts
interface Session {
  execute<T = unknown>(query: SQLStatement): Promise<T[]>;
  beginTransaction?(): Promise<TransactionSession>;   // required for $transaction
}
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

## Intended contents

- Bringing your own session (pooling, logging, tracing wrappers).
- Transaction session lifecycle and connection release.
- Error mapping (`40001` OCC failures) and how the transaction client retries them.

## Related

- [Querying](./querying.md)
- [Transactions](./transactions.md)
- [Install](./install.md)
