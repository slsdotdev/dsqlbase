---
"@dsqlbase/migration": minor
---

What a migration may do is set by risk, and a failed step fails the run.

- **`allow: { lossy?, destructive? }`** replaces `destructive`. `safe` steps always run. `lossy` steps run by default: they remove what redeploying restores (an index, a default, a constraint, an identity), or drop a column deprecated in an earlier release. `destructive` steps — dropping a table, a column, a sequence, a domain or a schema — need `allow.destructive: true`.
- **`run` and `dryRun` list every step `allow` doesn't cover** in the `MigrationError` they throw (`DESTRUCTIVE_NOT_ALLOWED`, `LOSSY_NOT_ALLOWED`), with each step's note; `plan(definition, { allow })` marks them `blocked`.
- **`run` throws when a step fails.** It stops at that step and throws a `MigrationError` with a `STEP_FAILED` issue naming it; `error.result` is the full `RunResult`, the steps after it `skipped`. A re-run plans from the database as it now is, and resumes there.
- **`MigrationError` is exported,** with `MigrationIssue`.
- **`ifExists`** replaces `safeOperations`. It only adds `IF [NOT] EXISTS`, and defaults to `true`. Drops are always `RESTRICT`.

**Breaking:** `destructive`, `safeOperations` and `PlanResult.destructive` are replaced as above; dropping an index now runs by default, as a lossy step; and `run` throws on a failed step where it used to resolve with it in its rows. To print the report on failure, pass `error.result` to `formatPlan`.

Docs: docs/guide/migrations.md, docs/internals/migration-pipeline.md
