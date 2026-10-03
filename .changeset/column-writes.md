---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Column writes:

- **`$onUpdate` runs on every update,** not only when the update also names its column, so `updatedAt.$onUpdate(() => new Date())` works on its own. A value the update sets still wins, and the hook's value is validated and encoded like any written value.
- **`numeric()` / `decimal()` take `{ precision, scale }`** and default to `numeric(18,6)` — what DSQL makes of a bare `numeric` — so Postgres and PGlite store the same type and DSQL no longer re-plans it. A value the column would round or overflow throws `ColumnValidationError` instead of being rounded silently.
- `identity(name, { sequenceName })` keeps the sequence name it is given.

**Breaking:** an update writes every column with an `$onUpdate` hook; a bare `numeric()` is `numeric(18,6)` on Postgres and PGlite; writes that would round a `numeric` now throw.

Docs: docs/guide/schema.md, docs/guide/dsql-notes.md
