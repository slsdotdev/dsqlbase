---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Relations in `select`: `select: { id: true, author: { name: true } }` reads exactly as `join: { author: { select: { name: true } } }` — same SQL, same result type. A relation takes `true` or a field map over its target, which may name the target's own relations. Filters, order and limits on a relation stay in `join`, and naming one relation in both throws.

No `select`, or one naming nothing as `true`, returns every column; naming columns returns those; naming only relations returns only the relations.

**Breaking:**

- The result type of `select: {}` (or an all-`false` select) is the full row, as the runtime already returned. A `join` key set to `false` is no longer in the result type.
- `@dsqlbase/core`: `SelectOperationArgs.select` is optional, and `[]` now means no column rather than every column.

Docs: docs/guide/querying.md, docs/guide/relations.md, docs/decisions/0010-relation-select.md
