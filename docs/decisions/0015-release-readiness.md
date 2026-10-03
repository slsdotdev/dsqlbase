# 0015 — Release readiness for 0.2.0

- **Date:** 2026-10-03
- **Status:** accepted
- **Proposal:** `release-readiness.md` (local working artifact, not tracked)
- **Builds on:** [0014](./0014-migration-dsql-catchup.md) — the migration pipeline, risk gates and
  reporting this hardens

## Context

0.2.0 gathers everything since 0.1.6: tenancy, global ids, pagination, polymorphic relations,
relations in `select`, JSON columns, embedded objects, and the migration catch-up. A review before
release — three code reviews, a dependency audit, and an audit of CI and repository settings —
found defects that should not ship in the first release that plans drops:

- Objects in a `namespace()` were created in `public` and dropped by the next plan.
- `run()` resolved normally when a step failed.
- Some plans never converged: a planner cycle on type changes, and derived names past 63 bytes
  that the server truncated.
- The `pg` session leaked pool connections on a failed `BEGIN`, `COMMIT` or `ROLLBACK`.
- `bigint` values lost precision inside joined and union rows.
- No tarball contained `LICENSE`, and the Version Packages pull request could not pass its
  required check without an admin bypass.

## Decision

### Migrations

- **`run` throws `MigrationError` (`STEP_FAILED`) at the first failed step**, carrying the whole
  `RunResult` as `result` and the step's error as `cause`. A failed async-job wait fails its step
  the same way. Rejected: an `ok` flag on the result. A caller that only awaits `run` — the common
  case — would still see success, so the safe default has to be the throw.
- **Every statement on a table, index, sequence or domain is schema-qualified** through one
  helper, `schemaOf`. A column typed by a domain keys it as `namespace.name`, as the planner keys
  the domain. A domain column is compared by that key, not by `dataType`, which the definition
  quotes and `format_type` doesn't.
- **A deprecated column's drop stays `lossy`.** `.deprecated()` in an earlier release is the
  explicit step that retires the column's data. Rejected: reclassifying it `destructive`, which
  would make that step pointless. Only the docstrings, which claimed no row data is ever lost,
  were wrong.
- **A changed index is rebuilt by swap:** build `<name>_rebuild`, drop the old index, then
  `ALTER INDEX … RENAME` (verified live on DSQL, though undocumented). A changed UNIQUE builds its
  index before its old constraint is dropped. A `_rebuild` or `_idx` index left by a run that
  stopped part-way is dropped by the step that builds that name again. Rejected: drop-then-create,
  which leaves the index unavailable, and uniqueness unenforced, for the whole build.
- **Derived names stay within 63 bytes.** `<table>_<column>_key` and `_not_null` use
  `postgresObjectName`, which reproduces PostgreSQL's `makeObjectName` (checked against PGlite),
  so `_key` matches the name the database gave an inline `UNIQUE`. Names only the planner builds
  (`_rebuild`, a UNIQUE's `_idx`) are cut and end in a fingerprint of the full name
  (`deriveIdentifier`). Rejected: the fingerprint form for `_key` too, since it would stop
  matching what `CREATE TABLE` created.
- **The planner never adds a reference edge between two steps of one change.** Step order
  already orders them, and a reference against it closed a cycle: a rebuild's `CREATE INDEX`
  before its `DROP`, or a type change recreating an index and a CHECK.
- **A backfill stops at the first batch that fills no row,** since its default is `NULL` for
  the rows matched. A literal `NULL` default counts as none at plan time. Rejected: a cap on the
  number of batches, which needs a `COUNT(*)` scan up front and only bounds the loop that this
  rule stops exactly. The batch size stays 1,000 for DSQL's 3,000 rows per transaction. Halving
  it on the 10 MiB limit waits for a probe of the error DSQL returns.
- **`updatePendingJobsStatus` is kept and fixed.** It batches independent async jobs for a
  driver that waits only before a dependent step. It bound its id array as one parameter.

### Runtime

- **A transaction's connection is returned exactly once on every path,** and destroyed when it
  broke (no SQLSTATE). `rollback()` never throws, and `$transaction` ignores a rollback failure,
  so the original error is thrown and decides the OCC retry. Rejected: attaching the rollback
  failure as the original error's `cause`. It didn't cause that error, and destroying the
  connection already ends the transaction on the server.
- **Exact numbers travel as text inside JSON projections.** A joined or union level projects
  every column with `Column.textInJson` (runtime type `bigint`, or SQL type `bigint` / `int8` /
  `numeric` / `decimal`) as `::text`, so the codec gets the same string as at the root. The column
  decides, not a type list in the query builder.
- **Filter edge cases:**
  - an object naming no known operator is a value only where values can be plain objects
    (`interval`, JSON types), and otherwise throws;
  - `%` and `_` are escaped in `LIKE` patterns;
  - `in: []` renders `FALSE` and `notIn: []` renders `TRUE`;
  - an `or` with a `{}` branch matches every row;
  - an unknown sort direction throws.

### Release pipeline and packages

- **`release.yml` splits into `verify` and `publish`.** `verify` re-runs the whole gate with a
  read-only token. `publish` holds the write token and OIDC, and installs with `--ignore-scripts`.
- **The Version Packages PR gets its required check through `workflow_dispatch`.** `publish`
  starts the quality gate on `changeset-release/main` itself. Rejected:
  - a GitHub App token, which needs repository secrets, and the repository takes none;
  - approving the bot's run by hand, which is a manual step on the publishing path. It stays the
    fallback.
- **Published packages declare `engines.node >=22`,** below the repo's own Node 24. The quality
  gate runs every suite again on Node 22 to keep that true.
- **Packaging:**
  - `prepack` copies `LICENSE` in;
  - `exports` list `types` first;
  - `prebuild` empties `dist/`;
  - `publint` and `attw` run in CI;
  - sourcemaps carry their sources, which makes the tarballs about 60% larger.

### Scope

- **One branch, one commit per story,** merged before the Version Packages PR. Rejected: one PR
  per story, since the release PR is regenerated after every merge. Also rejected: shipping
  0.2.0 first and patching after, which would leave the data-loss defaults live in between.
- **`update` / `delete` changing every matching row while returning one is a known issue,** not
  fixed here. It predates 0.2.0, and the fix is an API choice that breaks callers. It is
  documented in the guide and the changelog.

## Consequences

- **Breaking (`minor` in 0.x):**
  - `run` throws on a failed step;
  - `%` and `_` in pattern filters match literally;
  - an object naming only unknown operators throws;
  - `@dsqlbase/core/sql/expressions` is removed;
  - a namespaced domain column serializes `domain` as `namespace.name`.
- Every other change is a fix (`patch`).
- 0.2.0 ships with the open items listed in
  [Runtime pipeline → Known gaps](../internals/runtime-pipeline.md#known-gaps-fix-do-not-design-around)
  and
  [Migration pipeline → Out of scope today](../internals/migration-pipeline.md#out-of-scope-today-tracked-not-forgotten),
  each with its code path.
- The deploy lock, managed-object scope and expression comparison all point at one future
  design: an applied-definition snapshot table.

## Docs

- `docs/guide/migrations.md`
- `docs/guide/sessions.md`, `docs/guide/transactions.md` (written out from stubs)
- `docs/guide/querying.md`, `docs/guide/global-ids.md`, `docs/guide/install.md`
- `docs/internals/migration-pipeline.md`, `docs/internals/runtime-pipeline.md`,
  `docs/internals/codec-boundary.md`, `docs/internals/conventions.md`,
  `docs/internals/testing.md`, `docs/internals/architecture.md`

## Related

- [0014 — Migrations: DSQL catch-up](./0014-migration-dsql-catchup.md)
- [Conventions → Design workflow](../internals/conventions.md#design-workflow)
