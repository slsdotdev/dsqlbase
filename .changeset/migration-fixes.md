---
"@dsqlbase/migration": minor
"@dsqlbase/core": minor
---

Migration fixes, most found against a live DSQL cluster:

- **An unchanged schema plans nothing on a second run.** Defaults compare by meaning rather than spelling; sequence and identity options by their effective values; composite primary keys and DSQL's implicit primary-key `INCLUDE` no longer re-plan; a `NULLS FIRST` index key is read back correctly.
- **Objects in a `namespace()` are created, altered and dropped in their own schema.** Statements named them unqualified, so a table landed in `public` and the next plan dropped it. A column typed by a domain in a namespace uses its schema-qualified type.
- **Derived constraint names stay within PostgreSQL's 63 bytes,** shortened as PostgreSQL shortens its own, so a long `<table>_<column>_not_null` is found again instead of failing every later deploy.
- **Async DDL no longer hangs on DSQL;** jobs are read and waited for correctly.
- **`CREATE TABLE` carries identity and generated columns,** which it dropped.
- **Key-column order is compared** for indexes and keys, and a constraint whose kind changes is replaced.
- **A change that recreates a column's index and CHECK** no longer stops the planner with a dependency cycle.

**Breaking:** a column typed by a namespaced domain serializes its `domain` as `namespace.name` and its type schema-qualified.

Docs: docs/guide/migrations.md, docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md
