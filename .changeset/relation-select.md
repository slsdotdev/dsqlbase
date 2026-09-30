---
"@dsqlbase/core": minor
"@dsqlbase/migration": minor
"dsqlbase": minor
---

Name relations in `select`. A relation takes `true` or a field map over its target (which may name the target's relations in turn) and reads exactly as the same relation in `join`: `select: { id: true, author: { name: true } }` is `select: { id: true }, join: { author: { select: { name: true } } }`, with the same SQL and result type. Filters, order and limits on a relation stay in `join`. A relation to a union takes the union's shared fields, and `on.<alias>.select` accepts the member's relations. Naming one relation truthy in both `select` and `join` is a type error at the call and throws when the query is built.

Which columns come back: no `select`, or one naming nothing as `true`, returns every column; naming columns returns those; naming only relations returns only the relations.

Breaking:

- `@dsqlbase/core`: `SelectOperationArgs.select` is optional. Omitted means every column, and `[]` now means **no** column (it used to mean every column). Anyone driving `OperationsFactory` directly with `select: []` should omit it instead.
- `dsqlbase`: the result type of `select: {}` or an all-`false` select, and of the same `return` on a write, is now the full row. The runtime already returned it; the type said `{ $$meta }`.
- `dsqlbase`: a read's `select` is typed `SelectionOf<T, S>`; `FieldSelectionOf<T>` stays the type of a write's `return`. A `join` key set to `false` is no longer in the result type (it was typed `never`).

Docs: docs/guide/querying.md, docs/guide/relations.md, docs/guide/polymorphic-relations.md, docs/internals/runtime-pipeline.md
