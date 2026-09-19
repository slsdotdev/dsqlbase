# Transactions

_Audience: application developers._

> **Status: stub.** Full content lands with the client work. What is here is accurate but brief.

`dsql.$transaction(...)` runs work inside `BEGIN … COMMIT` on a dedicated transaction session and retries on DSQL's optimistic-concurrency failure (`SQLSTATE 40001`). Source: `packages/dsqlbase/src/client/transaction/`.

Two forms:

```ts
// 1. Batch: an array of unawaited queries, executed in order, results returned as a tuple.
const [user, task] = await dsql.$transaction([
  dsql.users.create({ data: { name: "Eve", email: "eve@example.com" } }),
  dsql.tasks.create({ data: { title: "Onboard", projectId } }),
]);

// 2. Callback: a scoped client with the same models bound to the transaction session.
await dsql.$transaction(async (tx) => {
  const user = await tx.users.findOne({ where: { id: { eq: userId } } });
  await tx.tasks.update({ set: { assigneeId: user?.id }, where: { id: { eq: taskId } } });
});
```

The session passed to `createClient` must implement `beginTransaction()`; both provided sessions do.

## Intended contents

- OCC retry policy (`maxRetries: 3`, `delay: 50`, `maxDelay: 1000` in `occ-retry.ts`). Not configurable from `$transaction` yet; exposing the options is client work.
- DSQL transaction limits (3,000 rows, one DDL per transaction, no DDL + DML mixing) and how they surface.
- Isolation semantics and what a retry re-executes.

## Related

- [Querying](./querying.md)
- [Sessions](./sessions.md)
- [DSQL notes](./dsql-notes.md)
