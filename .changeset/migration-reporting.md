---
"@dsqlbase/migration": minor
---

Plans report what they change, one row per step.

A change — one difference on one column, index or constraint — runs as one or more steps, each a single statement in its own transaction, so a failure points at exactly one step. `runner.plan()` returns `rows` and the plan's highest `risk`; `runner.run()` returns `rows` with each step's `status`, `durationMs` and `error`. `formatPlan(planOrRows, { format, sql })` prints them as a text or markdown table: subject, action, target, attribute changes (`from` → `to`), risk, async, and a note where a step needs one.

**Breaking:** `DDLOperation` requires a `summary`; column changes are no longer batched into one `ALTER TABLE`.

Docs: docs/guide/migrations.md
