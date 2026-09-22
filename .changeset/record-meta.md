---
"dsqlbase": minor
---

Add `$$meta` to every result row, and `table().meta()` to put your own data in it.

The result resolver could turn a driver row into an object of decoded columns and nothing else: a nested branch of the tree was a bare array of field resolvers, so when it recursed into `user.workspace` it had no way to know the rows came from `workspaces`. Anything per-row that depends on which table a row came from was impossible below the top level.

- Every result record now carries `$$meta` — `{ key, table, schema? }` plus whatever `table().meta()` declared. `key` is the schema alias (`members`), `table` the database name (`team_members`). Present on `findOne` / `findMany` rows, on each level of a join, and on `return` rows from `create` / `update` / `delete`.
- `table("tasks", { … }).meta({ __typename: "Task" })` declares extra fields and types them on the row. Metadata is excluded from `toJSON`, so it never reaches a migration.
- Each join level reports its own table, not its parent's. An absent `belongsTo` stays `null` and an empty `hasMany` stays `[]` — no row, no meta.
- `$$meta` is an ordinary enumerable property, first key on the record, so it survives `{ ...row }` and `JSON.stringify`.
- The resolver gained a third entry kind, `MetaResolver = [fieldName, (row) => value]`, alongside the column and nested-level kinds. It receives the raw driver row, before codec decoding. `FieldResolver`'s nested branch widens from `FieldResolver[]` to `ResolverEntry[]`; its own meaning is unchanged.

Breaking: result rows gain a property, so a whole-row `toEqual` now needs `$$meta`. `$$meta` and `$$key` are reserved field names — a column of either throws at definition time, a relation of either when the client is created. A `table().meta()` key colliding with `key` / `table` / `schema` throws.

Docs: docs/guide/querying.md, docs/guide/schema.md, docs/guide/relations.md, docs/internals/runtime-pipeline.md
