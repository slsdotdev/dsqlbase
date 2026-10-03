---
"@dsqlbase/migration": minor
---

Fix the migration bugs found by auditing against a live DSQL cluster:

- **Async DDL no longer hangs on DSQL.** The executor read `sys.jobs` through an unquoted `jobId` alias, which Postgres folds to `jobid`. The job id came back `undefined`, and `sys.wait_for_job(NULL)` blocked forever. Jobs are now read by their snake_case columns, and the result of `CALL sys.wait_for_job` (`{ succeeded }`) decides the outcome. `OperationExecutor.getAsyncJob` now returns `undefined` when the job isn't found.
- **Identity and generated columns now reach `CREATE TABLE`.** Both used to be dropped from a new table. An identity's sequence name is emitted as `SEQUENCE NAME`.
- **Sequence and identity options compare by effective value.** An option the definition leaves unset counts as the database default, so it no longer re-plans on every run. `ALTER SEQUENCE` lists only the options that changed, and an identity's sequence name only counts when the definition sets one.
- **Key-column order is compared** for indexes, primary keys and unique constraints. A reorder used to go unnoticed. `include` lists still compare as sets. The diff no longer reorders the arrays it is given.
- **A constraint whose kind changes under the same name** is now removed and added, instead of only removed.
- **Breaking: `safeOperations` no longer turns drops into `CASCADE`.** Drops are always `RESTRICT`: `CASCADE` removed objects the plan never listed, and DSQL refuses `DROP DOMAIN … CASCADE`. A table drop now precedes the drop of a domain its columns use.
- **Breaking: index columns lose `sortDirection`.** DSQL refuses `ASC` / `DESC` on index keys, so introspection no longer reads it and the printer no longer emits it.

Docs: docs/internals/dsql-capabilities.md (re-verified 2026-10-03 against the docs and a live cluster), docs/internals/migration-pipeline.md, docs/guide/migrations.md, docs/guide/dsql-notes.md
