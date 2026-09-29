---
"dsqlbase": minor
---

Filter and order a union by member with the `$$key` pseudo-field.

In a union's shared `where`, `$$key` accepts `eq`, `neq`, `in` and the bare-value shorthand, inside
`and` / `or` / `not` too, with values typed as the member aliases. It is how a runtime value,
such as a resolver's type argument, becomes a filter:
`where: { $$key: { in: types } }`. `orderBy: { $$key: "asc" }` sorts by member alias.

`$$key` never reaches SQL as a condition. The member alias is a constant within each branch, so
the client decides every `$$key` condition per member while it builds the query:

- a member that cannot match produces no branch;
- a condition every member satisfies is dropped;
- an `or` mixing `$$key` with other fields keeps only the conditions still open for that member;
- when no member is left, the join adds no SQL.

A value that is not a member alias, or any other operator, throws. The result type is
unchanged, because the value is usually known only at runtime. `on: { alias: false }` removes a
member from the type as well.

Docs: docs/guide/polymorphic-relations.md, docs/internals/runtime-pipeline.md
