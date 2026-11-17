# Pagination

_Audience: application developers._

`paginatedQuery` reads a list one page at a time, and `count` counts it. Pages are **keyset** pages: each one continues from a cursor — the position of a row you saw — rather than from an `offset`, so a page never repeats or skips a row because another one was inserted or deleted in front of it, and a late page does not read and throw away every row before it the way an `OFFSET` does. Source: `packages/dsqlbase/src/client/normalizers/pagination.ts` and `ModelClient.paginatedQuery` / `count` in `packages/dsqlbase/src/client/clients/model.ts`.

```ts
const page = await dsql.tasks.paginatedQuery({
  where: { status: { in: ["todo", "in_progress"] } },
  orderBy: { dueDate: "asc", createdAt: "desc" },
  select: { id: true, title: true },
  join: { project: { select: { name: true } } },
  limit: 20,
  after: previous?.nextCursor,
});

page.items; // the rows, shaped by select and join like findMany's
page.items[0].__cursor; // each row's own cursor
page.hasMore; // boolean — another page follows in the direction you read
page.nextCursor; // the last item's cursor when hasMore, otherwise null
```

`paginatedQuery` takes `select`, `where`, `orderBy` and `join` exactly as [`findMany`](./querying.md) does, plus `limit`, `after` and `before`. It does not take `offset`, `distinct` or a `count` option.

## Order

A page is read under a **total order**: the `orderBy` you wrote, then every primary-key column you did not already name. Two rows never tie, so every row has exactly one position and a cursor names it unambiguously. An appended key runs in the direction of your last one, or ascending when you gave no `orderBy`.

```ts
await dsql.tasks.paginatedQuery({ orderBy: { createdAt: "desc" } });
// runs as ORDER BY created_at DESC, id DESC
```

**The table needs a primary key**, single or composite; one without is refused when the query is built, before any SQL runs.

**Nullable order keys** sort their nulls where Postgres does by default — **last ascending, first descending** — and `paginatedQuery` writes that placement into the `ORDER BY` explicitly, so it never depends on a server setting:

```ts
await dsql.tasks.paginatedQuery({ orderBy: { dueDate: "asc" } });
// runs as ORDER BY due_date ASC NULLS LAST, id ASC
```

A page crosses from values into nulls, or through a long run of nulls, like any other tie: the primary key orders the rows within it, and a cursor taken on a row whose key is null carries that null. This is the same order `findMany` returns under the same `orderBy`, so the two agree row for row.

## Cursors

A cursor comes from an earlier page: `nextCursor`, or any item's `__cursor`. Pass it as `after` to read the rows that follow it, or as `before` for the rows that precede it — never both (the call throws).

A cursor is valid only under the order it was taken with: the same model and the same `orderBy`. Anything else — a cursor reused after the `orderBy` changed, handed to another model, cut short, or from a newer format — throws `InvalidCursorError`, exported from `dsqlbase`, with a `code` of `"format"`, `"version"` or `"mismatch"`.

`where`, `select` and `join` are **not** part of a cursor. Pass them again on every page. Changing `where` between pages is well-defined: you get the rows after the cursor's position that match the new filter.

A cursor is a position, not a snapshot. If a row's order-key value changes while you page — its `createdAt` rewritten, say — it moves in the order, and may be seen twice or not at all. Rows inserted or deleted elsewhere in the list do not disturb the pages around them.

Cursors are opaque strings. What they carry is each order key's value as the **database's own text** — `2026-09-27 12:00:00.123456+00`, not a JavaScript `Date` — because a `Date` holds milliseconds and a `timestamptz` holds microseconds: a cursor rebuilt from a `Date` would skip every other row written in the same millisecond. They are not signed or encrypted. A cursor someone edits by hand is only another position in the list; it grants nothing a `where` could not, and [row policies](./policies.md) apply to every page regardless.

## `hasMore` and `nextCursor`

A page reads one row more than `limit`; `hasMore` is whether that extra row came back, in the direction you are reading, and the extra row is dropped from `items`. The page does not say whether anything lies behind it: there is no `hasPreviousPage`, `startCursor` or `endCursor`.

| Read with          | `hasMore`                  | `nextCursor`                      |
| ------------------ | -------------------------- | --------------------------------- |
| no cursor / `after` | another page follows       | the last item's `__cursor`, or `null` when `hasMore` is `false` |
| `before`           | another page precedes      | the last item's `__cursor`, or `null` when `hasMore` is `false` |

A page read `before` a cursor comes back in the same order as every other page — first row first — not reversed. Because `nextCursor` is always the last item's cursor, to keep reading backwards pass the **first** item's `__cursor` as the next `before`.

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
- `maxLimit` — the largest `limit` a call may ask for; a larger one throws, naming both numbers. `100` when unset, so raise it to page in larger steps.

A `limit` must be a positive integer. The checks run when a page is requested, not in `createClient`: a `defaultLimit` above `maxLimit` (or above 100 with no `maxLimit`) throws on the first page that uses it.

## Counting

A page carries no total. `count` counts on its own, with the same `where` as the page:

```ts
const open = await dsql.tasks.count({ where: { status: "todo" } }); // number
const all = await dsql.tasks.count();
```

A count reads every row the filter selects, on every call. To read a page and its count from one snapshot, batch them in a [`$transaction`](./transactions.md).

## Transactions and row policies

A page batches in `$transaction([...])` like any other query, and `tx.<model>.paginatedQuery` works inside a callback. See [Transactions](./transactions.md).

A table's [row policies](./policies.md) bound both the page and `count`, exactly as they bound `findMany`. A cursor is never a boundary: one taken from a row the client cannot see is only a position, and the page it reads is still the rows the policies let that client see. See [Row policies](./policies.md).

## Indexes

Each page reads the rows past the cursor in index order when an index leads with the order keys followed by the primary key, and scans the filtered rows otherwise. Declare one for any order you page through often:

```ts
tasks.index("tasks_created_idx").columns((c) => [c.createdAt, c.id]);
```

Cursors assume the server's `DateStyle` stays the same between the page that produced a cursor and the one that consumes it; nothing in `dsqlbase` changes it.

## Behind a GraphQL connection

The page maps onto a Relay-style connection in a few lines, without the client knowing about GraphQL:

```ts
const page = await db.tasks.paginatedQuery({
  limit: args.first ?? undefined,
  after: args.after ?? undefined,
});

return {
  edges: page.items.map((node) => ({ node, cursor: node.__cursor })),
  pageInfo: {
    hasNextPage: page.hasMore,
    endCursor: page.nextCursor,
  },
};
```

`paginatedQuery` has no total or backwards flags: serve `totalCount` with a separate `count`, and `hasPreviousPage` / `startCursor` from your own bookkeeping.

## Unions

A [union's client](./polymorphic-relations.md#pages) pages the same way. It orders by
`orderBy`, then `__type`, then the members' primary keys, and signs its cursors against the
union.

## Related

- [Querying](./querying.md)
- [Transactions](./transactions.md)
- [Row policies](./policies.md)
- [Global ids](./global-ids.md)
