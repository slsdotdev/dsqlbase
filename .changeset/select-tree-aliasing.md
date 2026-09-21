---
"dsqlbase": minor
---

Alias every level of a select tree, so a relation can point at the table it comes from.

A join renders as `LEFT JOIN LATERAL` over a sub-select whose `FROM` re-declared the same correlation name as the outer query. Postgres resolved both sides of the join predicate to the inner table, so the correlation silently collapsed — a `tasks.parent → tasks` relation produced `WHERE "tasks"."parent_id" = "tasks"."id"`, matching each row against itself. The same collapse hit two different tables that share a name across schemas.

- Every select level now renders `FROM <table> AS "__t<n>"`, and each lateral join's JSON wrapper gets its own `"__j<n>"` instead of the fixed `"__t"` they all shared. Columns qualify against the alias bound for their level.
- Self-referential relations and joins between same-named tables in different schemas are correct. Sibling joins to one table at a single level were never affected.
- The join correlation is built by `QueryBuilder`, which is the only layer that knows what each level is aliased as. `JoinParams.from` / `to` are now `SQLNode[]` and correlate over every column pair.

Breaking: the SQL text of every select changes, flat queries included (`SELECT "__t0"."id" FROM "users" AS "__t0"`). Results are unchanged. Anything asserting on generated SQL needs updating. `UPDATE` / `DELETE` / `INSERT ... RETURNING` and `$query` are byte-identical to before — nothing binds an alias outside a select tree.

Docs: docs/internals/select-tree-aliasing.md, docs/internals/runtime-pipeline.md, docs/decisions/0003-select-tree-aliasing.md, docs/guide/relations.md
