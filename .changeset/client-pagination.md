---
"dsqlbase": minor
---

Keyset pagination: `paginate()` and `count()` on every model.

A GraphQL connection — or any cursor-paged list — used to mean hand-rolling the same code in every resolver: append the primary key to the order, build the `a < $1 OR (a = $1 AND id < $2)` predicate, fetch one extra row, trim it, encode a cursor, run a separate `count(*)`. That code is easy to get subtly wrong and cannot be made tenant-safe centrally. It now lives in the client.

**Paging.** `dsql.<model>.paginate({ select, where, orderBy, join, limit, after | before, count })` reads one page under a total order — your `orderBy`, then every primary-key column you did not name — so no two rows tie. It returns `{ items, hasNextPage, hasPreviousPage, startCursor, endCursor }`, with each item's own cursor at `$$meta.cursor`, and a `totalCount` when `count: true`. A page read `before` a cursor comes back in forward order.

**Cursors** carry each order key as the database's own text, so microsecond timestamps page correctly where a JS `Date` would skip rows. They are only valid under the order they were taken with; anything else throws `InvalidCursorError` (exported, with a `code`) before any SQL runs. `where`, `select` and `join` are passed again on every page.

**Counting.** `dsql.<model>.count({ where? })` resolves to a number. Both the page and the count go through the tenant seam, so a scoped client pages and counts only its own rows, and a cursor is never a way across.

**Configuring.** `createClient({ pagination: { defaultLimit, maxLimit } })` — `defaultLimit` is 100 when unset; `maxLimit`, when set, refuses a larger `limit`. Refused before any SQL: `after` with `before`, a bad or oversized `limit`, a table without a primary key, and — for now — a nullable order key.

**Batching.** `$transaction([...])` now accepts any `Executable`, the new interface both `ExecutableQuery` and the new `CompositeQuery` implement, so a counted page — two statements — batches like a single query. In `@dsqlbase/core`: `sql.keyset`, `SelectOperationArgs.keys`, `createCountOperation`, `Executable`, `CompositeQuery` and `ExecutionContext.pagination`.

Breaking: none at runtime. The `$transaction` array overload is typed over `Executable<unknown>[]` rather than `ExecutableQuery<unknown>[]`, which only widens what it accepts.

Docs: docs/guide/pagination.md, docs/guide/querying.md, docs/guide/transactions.md, docs/guide/README.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, docs/internals/dsql-capabilities.md, packages/dsqlbase/README.md, README.md
