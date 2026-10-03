---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Query fixes:

- **Self-relations and same-named tables in different schemas join correctly.** Every level of a select now has its own alias (`FROM "tasks" AS "__t0"`); before, a `tasks.parent → tasks` join matched each row against itself.
- **`bigint` values stay exact in joined rows and union rows,** which reach the client as JSON: `9007199254740993n` came back as `9007199254740992n`.
- **`$listByGlobalId` finds an id whose uuid is spelled differently** (upper case, braces, no hyphens), as `$findByGlobalId` does.
- **`$execute` refuses a `sql` template,** which it ran as nothing; pass one to `$query`, or call `.toQuery()`.

**Breaking:** the SQL text of every select changes (results don't), so tests asserting on generated SQL need updating. `@dsqlbase/core/sql/expressions`, an undocumented module duplicating the `sql` helpers, is removed: use `sql.eq`, `sql.and` and the rest.

**Known issue:** `update` and `delete` change every row their `where` matches but return only one of them. A fix is planned for the next release; until then, filter them by a unique key. See docs/guide/querying.md.

Docs: docs/guide/querying.md, docs/guide/global-ids.md, docs/internals/select-tree-aliasing.md, docs/internals/codec-boundary.md, docs/decisions/0003-select-tree-aliasing.md
