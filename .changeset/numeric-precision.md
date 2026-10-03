---
"dsqlbase": minor
---

`numeric()` / `decimal()` take `{ precision, scale }` and default to `numeric(18,6)`. That is what DSQL makes of a `numeric` declared without them: at most 12 integer digits and 6 decimals. The default is now stated explicitly, so Postgres and PGlite store the same type, and a DSQL column no longer re-plans as a type change. `{ precision }` alone means a scale of 0, as `numeric(p)` does.

Breaking:
- A write that the column would round (more decimals than `scale`) or overflow (more integer digits than `precision - scale`) now throws `ColumnValidationError` instead of being rounded silently. That covers `.default()` too.
- On Postgres and PGlite, a bare `numeric()` column is now `numeric(18,6)` instead of unbounded `numeric`.

Also, `identity(name, { sequenceName })` now keeps the sequence name it is given.

Docs: docs/guide/schema.md, docs/guide/dsql-notes.md, docs/internals/dsql-capabilities.md
