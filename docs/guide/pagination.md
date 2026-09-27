# Pagination

_Audience: application developers._

`paginate` reads a list one page at a time, and `count` counts it. Pages are **keyset** pages: each one continues from a cursor — the position of the last row you saw — rather than from an `offset`, so a page never repeats or skips a row because another one was inserted or deleted in front of it, and a late page does not read and throw away every row before it the way an `OFFSET` does. Source: `packages/dsqlbase/src/client/pagination/` and `ModelClient.paginate` / `count` in `packages/dsqlbase/src/client/model/client.ts`.

```ts
const page = await dsql.tasks.paginate({
  where: { status: { in: ["todo", "in_progress"] } },
  orderBy: { dueDate: "asc", createdAt: "desc" },
  select: { id: true, title: true },
  join: { project: { select: { name: true } } },
  limit: 20,
  after: previous?.endCursor,
});

page.items; // the rows, shaped by select and join like findMany's
page.items[0].$$meta.cursor; // each row's own cursor
page.hasNextPage; // boolean
page.hasPreviousPage; // boolean
page.startCursor; // the first item's cursor, or null on an empty page
page.endCursor; // the last item's cursor, or null on an empty page
```

`paginate` takes `select`, `where`, `orderBy` and `join` exactly as [`findMany`](./querying.md) does, plus `limit`, `after`, `before` and `count`. It does not take `offset` or `distinct`.

## Order

A page is read under a **total order**: the `orderBy` you wrote, then every primary-key column you did not already name. Two rows never tie, so every row has exactly one position and a cursor names it unambiguously. An appended key runs in the direction of your last one, or ascending when you gave no `orderBy`.

```ts
await dsql.tasks.paginate({ orderBy: { createdAt: "desc" } });
// runs as ORDER BY created_at DESC, id DESC
```

**The table needs a primary key**, single or composite; one without is refused when the query is built, before any SQL runs.

**Nullable order keys** sort their nulls where Postgres does by default — **last ascending, first descending** — and `paginate` writes that placement into the `ORDER BY` explicitly, so it never depends on a server setting:

```ts
await dsql.tasks.paginate({ orderBy: { dueDate: "asc" } });
// runs as ORDER BY due_date ASC NULLS LAST, id ASC
```

A page crosses from values into nulls, or through a long run of nulls, like any other tie: the primary key orders the rows within it, and a cursor taken on a row whose key is null carries that null. This is the same order `findMany` returns under the same `orderBy`, so the two agree row for row.

## Cursors

A cursor comes from an earlier page: `startCursor`, `endCursor`, or any item's `$$meta.cursor`. Pass it as `after` to read the rows that follow it, or as `before` for the rows that precede it — never both.

A cursor is valid only under the order it was taken with: the same model and the same `orderBy`. Anything else — a cursor reused after the `orderBy` changed, handed to another model, cut short, or from a newer format — throws `InvalidCursorError`, exported from `dsqlbase`, with a `code` of `"format"`, `"version"` or `"mismatch"`.

`where`, `select` and `join` are **not** part of a cursor. Pass them again on every page. Changing `where` between pages is well-defined: you get the rows after the cursor's position that match the new filter.

A cursor is a position, not a snapshot. If a row's order-key value changes while you page — its `createdAt` rewritten, say — it moves in the order, and may be seen twice or not at all. Rows inserted or deleted elsewhere in the list do not disturb the pages around them.

Cursors are opaque strings. What they carry is each order key's value as the **database's own text** — `2026-09-27 12:00:00.123456+00`, not a JavaScript `Date` — because a `Date` holds milliseconds and a `timestamptz` holds microseconds: a cursor rebuilt from a `Date` would skip every other row written in the same millisecond. They are not signed or encrypted. A cursor someone edits by hand is only another position in the list; it grants nothing a `where` could not, and [tenancy](./tenancy.md) applies to every page regardless.

## The two flags

`hasNextPage` and `hasPreviousPage` are exact in the direction you are reading: a page reads one row more than `limit`, and whether that row came back is whether another page follows. In the other direction a flag only says whether you arrived with a cursor — a page read `after` a cursor has at least the cursor's own row before it.

| Read with | `hasNextPage`        | `hasPreviousPage`     |
| --------- | -------------------- | --------------------- |
| no cursor | another page follows | `false`               |
| `after`   | another page follows | `true`                |
| `before`  | `true`               | another page precedes |

A page read `before` a cursor comes back in the same order as every other page — first row first — not reversed.

## Page size

`limit` sets the page size. Without one, the client's default applies:

```ts
const dsql = createClient({
  schema,
  session,
  pagination: { defaultLimit: 50, maxLimit: 200 },
});
```

- `defaultLimit` — the page size when a call names none. `100` when unset.
- `maxLimit` — optional; a larger `limit` throws, naming both numbers. Unbounded when unset.

A `limit` must be a positive integer. `createClient` rejects a `defaultLimit` above `maxLimit`.

## Counting

`count: true` adds a `totalCount` to the page: every row your `where` selects, ignoring the cursor, so the number stays the same as the pages advance.

```ts
const page = await dsql.tasks.paginate({ where: { status: "todo" }, limit: 20, count: true });
page.totalCount; // number
```

`count` counts on its own:

```ts
const open = await dsql.tasks.count({ where: { status: "todo" } }); // number
const all = await dsql.tasks.count();
```

A count is a second statement and reads every row the filter selects, on every call — which is why it is opt-in on a page. The two statements of a counted page run concurrently: on a pool they may use two connections, and so two snapshots a moment apart; inside [`$transaction`](./transactions.md) they share one.

## Transactions and tenancy

A page — counted or not — batches in `$transaction([...])` like any other query, and `tx.<model>.paginate` works inside a callback. See [Transactions](./transactions.md).

On a client scoped with `$identityClaims`, the tenant predicate bounds both the page and the count, exactly as it bounds `findMany`. A cursor is never a tenant boundary: one taken from another tenant's row is only a position, and the page it reads is still that client's rows alone. See [Tenancy](./tenancy.md).

## Indexes

Each page reads the rows past the cursor in index order when an index leads with the order keys followed by the primary key, and scans the filtered rows otherwise. Declare one for any order you page through often:

```ts
tasks.index("tasks_created_idx").columns((c) => [c.createdAt, c.id]);
```

Cursors assume the server's `DateStyle` stays the same between the page that produced a cursor and the one that consumes it; nothing in `dsqlbase` changes it.

## Behind a GraphQL connection

The page maps onto a Relay-style connection in a few lines, without the client knowing about GraphQL:

```ts
const page = await db.tasks.paginate({
  limit: args.first ?? undefined,
  after: args.after,
  count: true,
});

return {
  edges: page.items.map((node) => ({ node, cursor: node.$$meta.cursor })),
  pageInfo: {
    hasNextPage: page.hasNextPage,
    hasPreviousPage: page.hasPreviousPage,
    startCursor: page.startCursor,
    endCursor: page.endCursor,
  },
  totalCount: page.totalCount,
};
```

`after` and `before` accept `null`, as GraphQL arguments arrive.

## Related

- [Querying](./querying.md)
- [Transactions](./transactions.md)
- [Tenancy](./tenancy.md)
- [Global ids](./global-ids.md)
