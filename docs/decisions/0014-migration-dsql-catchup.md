# 0014 — Migrations: DSQL catch-up, changes and steps, risk gates

- **Date:** 2026-10-03
- **Status:** accepted
- **Proposal:** `migration-dsql-catchup.md` (local working artifact, not tracked)
- **Builds on:** [0002](./0002-migration-consolidation.md) — the pipeline, the invariants and the
  refusal model, which this keeps; it supersedes 0002's refusals and its `destructive` /
  `safeOperations` options

## Context

The migration module was written against an older reading of DSQL. It refused most changes to an
existing table: `DROP COLUMN`, `SET DEFAULT`, `DROP NOT NULL`, adding a CHECK, dropping a
constraint, changing an index. DSQL supports all of these now. The module also had bugs that made
it unusable against DSQL:
- every async job hung, on an unquoted `jobId` alias;
- every existing table with a default re-planned as a refusal, so `run` threw on any second run;
- identity and generated columns were left out of `CREATE TABLE`;
- a domain's changed CHECK, an index's column order, and a CHECK's placement were ignored or
  misread.

Operations also had no way to report what they do, beyond the statement itself.

The audit re-read the DSQL docs, then ran 119 statements against a live cluster, because the docs
are silent or wrong on several points. That turned up two surprises: `ADD COLUMN` takes no
attributes at all, not even `DEFAULT`, and `ALTER DOMAIN` works partly although it isn't
documented. Each story was then checked on the same cluster with the real executor.
`docs/internals/dsql-capabilities.md` records the results.

## Decision

### Changes and steps

- A **change** is one difference on one target: a column, an index, a constraint. It runs as one
  or more **steps**, and each step is one operation: one statement, one transaction, one report
  row. Statements are never batched into a shared `ALTER TABLE`, so a failure points at one step.
  The planner keeps a change's steps in order (an edge from step k to step k + 1).
- Every operation carries a `summary`: change, step `i/n`, subject, action, target, attribute
  changes, risk, and whether it's async.
  - `plan()` returns `rows` and the plan's highest `risk`.
  - `run()` returns the rows with `status`, `durationMs` and `error`, stops at the first failed
    step, and reports the rest as `skipped`.
  - `formatPlan()` prints rows as a text or markdown table, with notes for destructive and
    blocked steps and the refusals' messages.
- A re-run resumes from the diff. No journal is kept: the runner stays declarative.

### Risk, and what a run may do

- **The test is: can redeploying the previous definition undo it?** On DSQL that isn't the same as
  "are rows lost", since some things can't be re-created.
  - `safe`: adds or relaxes.
  - `lossy`: removes what redeploying restores — a default, an index, a CHECK or UNIQUE, an
    identity, a column's NOT NULL, a deprecated column.
  - `destructive`: loses data, or removes what DSQL can't re-create — dropped tables, columns,
    sequences, domains, schemas; type changes; `DROP EXPRESSION`; a domain's NOT NULL or CHECK.
- `allow: { lossy, destructive }` replaces `destructive`. Lossy steps are allowed by default;
  destructive ones need opt-in. A blocked plan throws, naming every step and its note.
- `ifExists` replaces `safeOperations`. Drops are always `RESTRICT`: a `CASCADE` removed objects
  the plan never listed, and DSQL refuses it for domains. An opt-in `cascade` option was
  considered and left out for the same reason.

### Policy, built from what DSQL allows

- **Columns:**
  - A column is added bare; its default follows as `SET DEFAULT`, and existing rows stay NULL.
  - **NOT NULL on an existing table** is a backfill (`UPDATE … SET c = DEFAULT`, 1,000 rows per
    transaction, retried on `40001`), then `CHECK (c IS NOT NULL)` named
    `<table>_<column>_not_null`, added `NOT VALID` and validated. The diff reads that CHECK as the
    column's NOT NULL. Adding a NOT NULL column without a default is refused.
  - A **type change** drops and re-adds the column, then re-creates its indexes and constraints
    (destructive). The note says how to keep the data: add a column, copy, deprecate the old one.
  - Identity options are set in place, never `RESTART`. An identity can't be added to an existing
    column: PostgreSQL needs it NOT NULL first, which DSQL can't add.
- **Constraints:**
  - A CHECK is added `NOT VALID`, then validated with `ALTER TABLE ASYNC`. A failed validation
    stops the run and leaves the constraint enforced but not valid; the next plan re-validates it,
    since introspection reads `convalidated`.
  - UNIQUE uses the build-then-promote path. Dropping a CHECK or UNIQUE is `DROP CONSTRAINT`.
  - A primary key can't change.
- **Indexes:** a change, or a failed async build (`indisvalid`), rebuilds the index. Expression
  keys and partial predicates are modelled.
- **Domains:** `SET` / `DROP DEFAULT`, `DROP NOT NULL`, `DROP CONSTRAINT`. Adding a CHECK or NOT
  NULL, or changing the type, is refused, with a new domain as the workaround.
- **Refusals** each have a specific code and a message saying what to do instead.

### Comparison

- **Constraints compare wherever they were declared.** The catalog doesn't record whether a
  one-column constraint was written on the column or on the table, so CHECK and UNIQUE compare by
  name (a column's `unique` is `<table>_<column>_key`) and the primary key by its columns.
- **Defaults compare through `sameDefault`:** keyword case, a literal's cast, number quoting and
  JSON formatting are ignored.
- **CHECK expressions, index expressions and predicates aren't compared as text.** CHECKs compare
  by name, index keys by position, predicates by presence. PostgreSQL prints expressions back
  deparsed — `BETWEEN` expanded, `LIKE` as `~~`, casts added, timestamps in the session time zone.
- **Rejected:**
  - Hand-written rules, as an open-ended set.
  - Canonicalizing the definition through an in-memory PGlite. It worked (41/41 expressions
    identical against DSQL), but it costs the package a ~23 MB dependency.
- A **migration state** (a snapshot of the last applied definition) is planned instead. It compares
  definition with definition and closes this gap.

### Renames and deprecation

- **`.renamedFrom(previous)`** on a column or table emits `RENAME`, plus `RENAME CONSTRAINT` /
  `ALTER INDEX … RENAME` for the names derived from the old one, composed when a table and its
  columns are renamed together. When both names exist it's refused.
- **`.deprecated()`** hides a column from the client, in the types and at runtime. It marks the
  column with the comment `dsqlbase:deprecated` and drops a default-less NOT NULL. Removing the
  column in a later release is then lossy, not destructive. The marker lives in the database
  because the runner has no memory. A primary-key column and an embedded-object member can't be
  deprecated (member types are deferred).

### Fixed along the way

- The async job hang (B19).
- Identity and generated columns in `CREATE TABLE`.
- Index column order is compared.
- Sequence options compare by effective value, and only changed options are altered.
- `indoption` is read 0-based, so `NULLS FIRST` reads back correctly.
- The unique-promotion index honours `asyncIndexes`.
- DSQL's primary-key `INCLUDE`-everything is normalized away.
- `numeric()` defaults to `numeric(18,6)` — DSQL's own default, stated explicitly — and refuses
  writes it would round.
- Index sort direction is removed: DSQL refuses `DESC`.

## Consequences

- **Re-runs work.** The full e2e fixture plans nothing on a second run, on PGlite and on DSQL. A
  failed run resumes.
- **Breaking, `minor` across the packages:**
  - `MigrationRunnerOptions` (`allow`, `ifExists`).
  - `PlanResult.destructive` removed.
  - `DDLOperation.summary` required.
  - Refusal codes renamed.
  - `IndexColumnDefinition.sort()` removed.
  - `numeric()` precision.
  - Core `toJSON()` adds `validated`, `valid`, `where`, `deprecated` and `renamedFrom`.
- Async DDL is slow on DSQL even for small tables, 10–30 s per job, so plans with many index
  builds take minutes.
- Still deferred:
  - text comparison of CHECK and index expressions (to the migration state);
  - foreign keys (`relations()` stays runtime-only);
  - views;
  - deprecating embedded members;
  - sequence `OWNED BY`.

## Docs

- `docs/guide/migrations.md`: options, reporting, and how each change runs.
- `docs/guide/schema.md`: index expressions and predicates, `numeric`, `renamedFrom`,
  `deprecated`.
- `docs/guide/dsql-notes.md`.
- `docs/internals/migration-pipeline.md`: invariant 4 as changes and steps, comparison rules,
  operations, reporting, renames.
- `docs/internals/dsql-capabilities.md`: re-verified 2026-10-03 against the docs and a live
  cluster.
