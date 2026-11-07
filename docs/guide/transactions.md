# Transactions

_Audience: application developers._

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

The transaction client carries every model the client it came from shows, [union clients](./polymorphic-relations.md#reading-a-union-directly) included, bound to the transaction session.

A batch takes anything a model method returns, including a [page](./pagination.md) counted with
`count: true`, which is two statements rather than one. Inside the transaction both run on its
session, so the page and its `totalCount` read the same snapshot:

```ts
const [page, open] = await dsql.$transaction([
  dsql.tasks.paginate({ limit: 20, count: true }),
  dsql.tasks.count({ where: { status: "todo" } }),
]);
```

## Transactions with settings

A transaction opened on a client with [settings](./policies.md#per-request-clients) carries them: every query inside it is bounded by the [row policies](./policies.md) with those values, and a column filled from a setting is filled in it too. Its client has no raw SQL either.

```ts
const db = dsql.$settings({ workspaceId, userId });

await db.$transaction(async (tx) => {
  await tx.invoices.create({ data: { number: "INV-2" } });
});
```

Give the settings first, then open the transaction — a transaction client has no `$settings` of its own, so there is one order rather than two.

Batching a query built on a settings client into a transaction without settings is safe. An `ExecutableQuery` has its SQL fixed when the client builds it, and `$transaction([...])` only swaps the session each operation runs on, so the values are already bound:

```ts
await dsql.$transaction([db.invoices.findMany({})]);   // still bounded by `workspaceId`
```

A write that fails a policy's check throws `PolicyViolationError`; the transaction rolls back and the error is rethrown, never retried.

## Conflicts and retries

DSQL takes no locks: two transactions that touch the same rows both run, and the one that commits second fails with `SQLSTATE 40001` — usually at `COMMIT`. `$transaction` rolls back and runs the whole transaction again on a fresh one:

- **What reruns** — the callback, from the start, against a new transaction client; or every query of a batch, in order. Anything the callback does besides querying (a request, an email, a counter in memory) runs again too, so keep side effects out of it, or make them safe to repeat.
- **How often** — at most 3 runs: the first, then 2 retries. The delay before a retry doubles each time from 100 ms (with up to 10% jitter), capped at 1 s. Source: `packages/dsqlbase/src/client/transaction/occ-retry.ts`. These aren't configurable from `$transaction` yet.
- **What doesn't retry** — any other error. It is thrown as is, after the rollback; a rollback that fails too never replaces it.

A query awaited outside `$transaction` is its own transaction, and a `40001` from it is thrown to you: nothing retries it. Put writes that can conflict in a `$transaction`.

## Limits

A DSQL transaction writes at most 3,000 rows and 10 MiB, and lives at most 5 minutes; past a limit, the statement fails and the transaction rolls back. A transaction can't mix DDL with data changes, or hold more than one DDL statement — the [migration runner](./migrations.md) keeps to that for you. See [DSQL notes](./dsql-notes.md).

## Related

- [Querying](./querying.md)
- [Pagination](./pagination.md)
- [Row policies](./policies.md)
- [Sessions](./sessions.md)
- [DSQL notes](./dsql-notes.md)
