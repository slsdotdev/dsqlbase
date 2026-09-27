---
"dsqlbase": patch
---

An empty `where` no longer renders invalid SQL.

`findMany({ where: {} })` rendered a bare `WHERE ` and failed in the database, and an empty `and` / `or` group rendered `()`. A resolver that forwards an empty filter object is ordinary, so reads now treat `{}` — and an empty group — as no filter at all: `findMany`, `count` and `paginate` select every row.

`findOne`, `update` and `delete` require a `where` by type, precisely so they cannot reach an arbitrary row or every row. For those an empty one is refused with an error when the query is built, before any SQL runs — it used to fail too, only later and as a syntax error from the database.

Docs: docs/guide/querying.md
