---
"@dsqlbase/migration": minor
---

**Breaking:** `run` throws when a step fails. It used to resolve with the failed step in its rows, so a deploy script that only awaited `run` reported success while the migration had stopped half-way. It now throws a `MigrationError` whose `issues` hold one `STEP_FAILED` naming the step and its error, and whose `result` is the full `RunResult`: the steps before, the failed one, and the rest as `skipped`. The step's thrown error, if any, is the `cause`. An error while waiting for an async job (`CALL sys.wait_for_job`) now fails its step the same way, instead of escaping `run` and losing the rows already executed.

`MigrationError` is exported, with its `MigrationIssue` and `MigrationErrorOptions` types, so a caller can `instanceof` it. To keep printing the report on failure, catch it and pass `error.result` to `formatPlan`.

Docs: docs/guide/migrations.md (Runner, Options), docs/internals/migration-pipeline.md (Runner and executor).
