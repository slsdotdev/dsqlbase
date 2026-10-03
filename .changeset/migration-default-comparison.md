---
"@dsqlbase/migration": patch
"@dsqlbase/core": patch
---

A schema that hasn't changed now plans nothing on a second run, on PGlite and on DSQL. Before, every existing table with a default or a composite primary key was refused, so `run` threw:

- **Defaults compare by meaning, not spelling.** PostgreSQL prints a default back deparsed (`current_timestamp` → `CURRENT_TIMESTAMP`, `'EUR'` → `'EUR'::text`, `'0'` → `0`). Keyword case is now ignored, along with a literal's cast and number quoting, and `json` / `jsonb` literals compare by value. A default spelled in a way these rules don't cover still re-plans as a change; it is never ignored.
- **Composite primary-key columns serialize as `NOT NULL`** in `TableDefinition.toJSON()`, as PostgreSQL stores them.
- **DSQL's primary-key `INCLUDE` is ignored.** On DSQL a primary key's index lists every other column, so introspection no longer reads it as a declared `INCLUDE`.

CHECK expressions are still compared by name only. That is deferred to a planned migration-state snapshot.

Docs: docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
