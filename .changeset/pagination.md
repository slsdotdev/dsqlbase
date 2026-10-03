---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Keyset pagination: `paginate()` and `count()` on every model.

- **`dsql.<model>.paginate({ select, where, orderBy, join, limit, after | before, count })`** reads one page under a total order — your `orderBy`, then every primary-key column you didn't name. It returns `{ items, hasNextPage, hasPreviousPage, startCursor, endCursor }`, each item's cursor at `$$meta.cursor`, and `totalCount` with `count: true`. A page read `before` a cursor comes back in forward order.
- **Order keys may be nullable.** Nulls sort where Postgres puts them by default — last ascending, first descending — and the `ORDER BY` states it, so pages don't depend on a server setting.
- **Cursors** carry each key as the database's own text, so microsecond timestamps and big integers page exactly. A cursor is valid only under the order it was taken with; anything else throws `InvalidCursorError` before any SQL runs.
- **`dsql.<model>.count({ where? })`** resolves to a number. Pages and counts go through the tenant predicate, so a cursor is never a way across tenants.
- **`createClient({ pagination: { defaultLimit, maxLimit } })`** — `defaultLimit` is 100; `maxLimit`, when set, refuses a larger `limit`. A `findMany` without `limit` still returns every row.
- **`$transaction([...])` accepts a counted page** (two statements) like any query. In `@dsqlbase/core`: `sql.keyset`, `Executable` and `CompositeQuery`.

Docs: docs/guide/pagination.md, docs/guide/querying.md, docs/decisions/0008-client-pagination.md
