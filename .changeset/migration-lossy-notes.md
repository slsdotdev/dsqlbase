---
"@dsqlbase/migration": patch
---

`allow.lossy` and `OperationRisk` now say exactly what a lossy step can cost: besides removing what redeploying restores, it drops a column deprecated in an earlier release, whose data `.deprecated()` already retired. Before, both said "no row data is lost".

The plan report also notes when an index is dropped because the definition doesn't declare it: the runner keeps no history, so it can't tell one removed from the definition from one created by hand.

Docs: docs/guide/migrations.md (report columns, Options, Constraints and indexes on existing tables), docs/internals/migration-pipeline.md (Operations).
