---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Filters, ordering and lookups that misbehaved on edge cases:

- **`%` and `_` in `beginsWith`, `endsWith` and a string `contains` match themselves.** They were sent into the `LIKE` pattern as wildcards, so `{ beginsWith: "%" }` matched every row. **Behaviour change** for a value that holds either character.
- **`in: []` matches no row, and `notIn: []` every row.** Both rendered `IN ()`, which PostgreSQL refuses as a syntax error. `sql.in` / `sql.notIn` with an empty list render `FALSE` / `TRUE`.
- **An object naming only unknown operators throws.** `{ assigneeId: { isNull: true } }` was taken as a value to compare and failed in the database; outside an `interval` column (a `Duration`), it now throws naming the operator and the column's valid ones.
- **`orderBy` refuses a direction other than `"asc"` or `"desc"`.** `"DESC"` was dropped silently, which changed the order.
- **`{ or: [{}, …] }` matches every row**, as `{}` does. The `{}` branch was dropped, narrowing the `or` to the others.
- **`$listByGlobalId` matches an id whose uuid is spelled differently** (upper case, braces, no hyphens), as `$findByGlobalId` already did; it returned `null` for it.
- **`$execute` refuses a `sql` template**, which has no `text`: it ran nothing, silently. Pass a template to `$query`, or call `.toQuery()`.

**Breaking:** `@dsqlbase/core/sql/expressions`, an undocumented module duplicating the `sql` helpers, is removed. Use `sql.eq`, `sql.ne`, `sql.gt`, `sql.lt`, `sql.gte`, `sql.lte`, `sql.and`, `sql.or` and `sql.not`.

Docs: docs/guide/querying.md (QueryArgs, Operators by column type), docs/guide/global-ids.md.
