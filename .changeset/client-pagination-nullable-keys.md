---
"dsqlbase": minor
---

`paginate()` accepts nullable order keys.

The first cut refused to page by a column that can hold `NULL`, since the keyset predicate `k > $1 OR (k = $1 AND …)` never matches a null. A nullable key now sorts its nulls where Postgres does by default — last ascending, first descending — and `paginate` writes that placement into the `ORDER BY` (`ASC NULLS LAST`, `DESC NULLS FIRST`) so it does not depend on a server setting. The keyset gains the matching branches: past a value ascending also reaches the nulls, past a null descending reaches every value, and a cursor taken on a row whose key is null carries that null. Pages walk every row exactly once in either direction, in the order `findMany` returns under the same `orderBy`.

In `@dsqlbase/core`, `sql.keyset` takes `(string | null)[]` values and honours `KeysetKey.nullable`. A `null` for a key that cannot hold one is still refused: `InvalidCursorError` from the client, an error from `sql.keyset`.

Docs: docs/guide/pagination.md, docs/internals/runtime-pipeline.md
