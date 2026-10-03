---
"@dsqlbase/migration": minor
---

Plans report what they change, one row per step.

- **Changes and steps.** A change is one difference on one target: a column, an index, a constraint. It runs as one or more steps, each a single statement in its own transaction. Column changes are no longer batched into a shared `ALTER TABLE`, so a failure points at exactly one step and a re-run resumes from there. The planner keeps a change's steps in order.
- **`DDLOperation.summary`** (required) records:
  - the change key, and the step's place in it (`step` / `steps`);
  - the subject (table, domain, sequence or schema) and the target (column, index, constraint, identity, default or options);
  - the action and the attribute changes (`from` → `to`);
  - the risk (`safe` / `lossy` / `destructive`), and whether it runs as an async job.

  Refusals carry a `summary` too.
- **`runner.plan()`** also returns `rows` (`PlanRow[]`: operations in execution order, then refusals) and `risk`, the highest risk in the plan. **`runner.run()`** also returns `rows`, each with `status`, `durationMs` and `error`.
- **`formatPlan(planOrRows, { format, sql })`** prints rows as an aligned text table or a markdown table, followed by refusal messages and failures.
- **Fixed:** the unique-promotion index now respects `asyncIndexes`. It always emitted `CREATE UNIQUE INDEX ASYNC`, which Postgres and PGlite reject.

Breaking:
- `DDLOperation` requires `summary`.
- `dropIndexOperation(object, tableName, options)` takes the table name.
- An identity change and a column add with an identity are now separate statements: `ALTER COLUMN … SET GENERATED` and `RESTART` are no longer combined into one `ALTER TABLE`.

Docs: docs/guide/migrations.md (Reporting), docs/internals/migration-pipeline.md (invariant 4, Planner, Reporting), packages/migration/README.md
