---
"@dsqlbase/migration": minor
---

Breaking: what a migration may do is set by risk, not by a `destructive` flag.

- **`allow: { lossy?, destructive? }`** replaces `destructive`.
  - `safe` steps always run.
  - `lossy` steps run by default (`allow.lossy`, default `true`). These remove what redeploying restores: an index, a default, a constraint, an identity.
  - `destructive` steps need `allow.destructive: true`. These drop tables, sequences, domains or schemas.

  **Behaviour change:** dropping an index used to need `destructive: true`; it now runs by default, as a lossy step.
- **`run` / `dryRun` list every blocked step.** They throw a `MigrationError` whose `issues` name each step `allow` doesn't cover (`DESTRUCTIVE_NOT_ALLOWED`, `LOSSY_NOT_ALLOWED`), alongside any refusals. `plan(definition, { allow })` marks those rows `blocked: true`, and `formatPlan` shows them as `(not allowed)`.
- **`ifExists` replaces `safeOperations`.** It only adds `IF [NOT] EXISTS`, and defaults to `true`, which was the runner's effective default.
- **`PlanResult.destructive` is removed;** use `risk`.
- **`run` stops at the first failed step.** The remaining rows are reported with `status: "skipped"`. A re-run plans from the database as it is, so it resumes there.

Docs: docs/guide/migrations.md (Options, Reporting), docs/internals/migration-pipeline.md
