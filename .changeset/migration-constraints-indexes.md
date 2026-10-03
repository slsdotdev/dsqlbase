---
"@dsqlbase/migration": minor
"@dsqlbase/core": minor
---

Constraints and indexes change on existing tables, within what DSQL allows (verified on a live cluster).

- **CHECK:** `ADD CONSTRAINT … NOT VALID`, enforced on new writes at once, then validated against existing rows by an async job. If a row violates it, the run stops and the constraint stays, not valid; once the data is fixed, the next plan is just the `VALIDATE`.
- **Changed indexes are rebuilt without a gap:** the new index is built beside the old one as `<name>_rebuild`, the old one dropped, and the new one renamed into place, so the old index serves reads and enforces uniqueness until then. A changed UNIQUE builds its new index before its old constraint is dropped. An index whose async build failed is repaired the same way, and a run that stops part-way starts over cleanly.
- **Expression and partial indexes:** ``.columns((c) => [sql`lower(${c.email})`])`` and ``.where((c) => sql`…`)``. Expressions and predicates compare by position and presence, since PostgreSQL prints them back reformatted: to change one, rename the index.
- **Removed CHECKs, UNIQUEs and indexes are dropped as lossy steps.** An index the definition doesn't declare is dropped too, and the plan notes that it may have been created by hand.
- **Constraints compare wherever they were declared** (on the column or on the table), and introspection reads back whether a CHECK is validated and an index valid.

**Breaking:** `IMMUTABLE_INDEX` is gone, and `IMMUTABLE_CONSTRAINT` now covers primary keys only. `IndexColumnDefinition.sort()` is removed: DSQL refuses `ASC` / `DESC` on index keys. `nullsFirst()` / `nullsLast()` remain.

Docs: docs/guide/schema.md, docs/guide/migrations.md, docs/internals/migration-pipeline.md
