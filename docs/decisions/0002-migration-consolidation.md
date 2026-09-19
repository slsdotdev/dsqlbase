# 0002 — Migration module consolidation (v1 shape)

- **Date:** 2026-09-19 (recorded; decisions taken 2026-05 through 2026-09 in the epic)
- **Status:** accepted
- **Proposal:** `.claude/epics/migration.md` (in progress; nine earlier proposals were deleted into it)

## Context

The migration module was built across nine proposals that drifted from each other and from the code. The epic consolidated them, took the implementation as source of truth where they conflicted, and recorded the durable rules. This record condenses what was decided; the design is in [Migration pipeline](../internals/migration-pipeline.md).

## Decision

- **Layering:** `SerializedSchema` is the contract between introspection and reconciliation; diffs are DSQL-agnostic; operations are the only policy layer; refusals are structured records, not exceptions; the planner is a type-agnostic topological sort over `references[]`.
- **Refusals over silent skips.** Any change the module cannot express is returned as a refusal; `run` / `dryRun` fail on them.
- **Constraints on existing tables are refused except UNIQUE**, which uses the index-promotion path (`CREATE UNIQUE INDEX ASYNC` → `ADD CONSTRAINT … UNIQUE USING INDEX`). Domain alters allow only `defaultValue`. *(Both are stricter than the current DSQL grammar; see Consequences.)*
- **Runner is a sequential CLI-shaped orchestrator**, not a durable-workflow host. It exposes `validate` / `introspect` / `reconcile` / `plan` / `dryRun` / `run`; durable hosts compose the primitives. Async DDL is detected by a `{ job_id }` response, not by statement kind. `executor.ts` stays as the per-op unit.
- **Validation** uses imperative rules keyed by node kind with a default registry inline; `INVALID_SEQUENCE_CACHE` lives only in validation; an unsupported-type rule was dropped as redundant with compile-time types.
- **Out of v1:** rename detection, FK emission, views/functions, triggers, grants, `OWNED BY` ordering (blocked on `SequenceDefinition.ownedBy` plumbing).

## Consequences

- One runner serves PGlite and DSQL via `asyncIndexes` / `safeOperations`.
- Several refusals (`NO_DROP_COLUMN`, `SET/DROP DEFAULT`, `DROP NOT NULL`, `CHECK`/FK `NOT VALID`, `DROP CONSTRAINT`) are now **stale** against DSQL's `ALTER TABLE` grammar verified 2026-09-19 — see [DSQL capabilities](../internals/dsql-capabilities.md). Relaxing them is the migrations proposal's job and will supersede parts of this record.
- `safeOperations` also switches drops to `CASCADE`; the flag is misnamed and under review.
- Renames appear as add + refused drop until an intent API exists.

## Docs

- `docs/internals/migration-pipeline.md`, `docs/internals/dsql-capabilities.md`, `docs/guide/migrations.md`.
