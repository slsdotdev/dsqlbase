---
"dsqlbase": minor
"@dsqlbase/core": minor
---

`$$meta` on every row, and `table().meta()` to put your own data in it.

Every result row — from `findOne` / `findMany`, each joined level, and the rows `create` / `update` / `delete` return — carries `$$meta: { key, table, schema? }`: `key` is the schema alias (`members`), `table` the database name (`team_members`). `table("tasks", { … }).meta({ __typename: "Task" })` adds your own fields to it, typed. It is the first key of the row and survives `{ ...row }` and `JSON.stringify`.

**Breaking:** rows gain a property, so a whole-row `toEqual` needs `$$meta`. `$$meta` and `$$key` are reserved field names.

Docs: docs/guide/querying.md, docs/guide/schema.md, docs/decisions/0004-record-meta.md
