---
"@dsqlbase/migration": patch
---

`allow.lossy` and `OperationRisk` now say exactly what a lossy step can cost: besides removing what redeploying restores, it drops a column deprecated in an earlier release, whose data `.deprecated()` already retired. Before, both said "no row data is lost".

The plan report notes the side effects of three lossy steps:

- dropping an index the definition doesn't declare — the runner can't tell one removed from the definition from one created by hand;
- rebuilding a unique index;
- dropping a changed UNIQUE constraint.

For the last two, uniqueness isn't enforced until the build completes, and a duplicate written in that window fails it.

Docs: docs/guide/migrations.md (report columns, Options, Constraints and indexes on existing tables), docs/internals/migration-pipeline.md (Operations).
