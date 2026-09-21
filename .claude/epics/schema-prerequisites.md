---
epic: schema-prerequisites
status: in-progress
owner: silviu
created: 2026-09-21
---

# Schema prerequisites — shared runtime work

Implements `.claude/proposals/schema-prerequisites.md`. Every story here is needed by at
least two of the schema features (`schema-guid.md`, `schema-polymorphic-relations.md`,
`schema-embeddable-objects.md`) or the client features (`client-pagination.md`,
`client-runtime-joins.md`, `client-tenancy.md`), or is a correctness fix they all rely on.
None introduces a feature.

## Working agreement

One branch (`feat/schema-prerequisites`), one PR, **one commit per story**, review between
stories. Each story carries its own changeset with a `Docs:` line and updates its docs pages
in the same commit. Stories 3 and 5 get a design note in this file, approved before coding.

## Stories

| # | Story | Level | Status |
|---|---|---|---|
| 0 | Run the type-level suite for real; build deps before test | `patch` | ✅ |
| 1 | `Table.primaryKey` / `isCompositeKey`; one-PK rule; PK `include()` fix | `minor` | ✅ |
| 2 | `Table.alias`, `getAlias`, `getTableEntries`, shared `attachModels` | `patch` | ⬜ |
| 3 | Table aliasing in select trees (`Scope` + `ColumnRef`) | `minor` | ⬜ design note first |
| 4 | Composite relation pairs + relation validation | `minor` | ⬜ |
| 5 | `$$meta`, `table().meta()`, row-aware resolver tree | `minor` | ⬜ design note first |
| 6 | `OnSelectionOf` + `resolveOnSelection` | `patch` | ⬜ |
| 7 | Codec-aware where clauses (`Column.param`) | `minor` | ⬜ |
| 8 | Duplicate DB column names; `getColumn` by path | `minor` | ⬜ |
| 9 | One field namespace per table | `minor` | ⬜ |

## Deviations from the proposal

- **Story 0 is new.** The proposal assumes type-level tests run. They did not: `packages/dsqlbase`
  documented `vitest run --typecheck` but no config enabled `typecheck`, and the build
  `tsconfig.json` excludes `*.test.ts`, so every `expectTypeOf` was a no-op. Stories 5 and 6 are
  largely type work, so this had to be real first. The turbo `test` task also gained
  `dependsOn: ["^build"]`.
- **Story 1 grew a one-primary-key rule and moved from `patch` to `minor`.** The proposal only
  asked for `Table.primaryKey`, but the key is only well-defined if exactly one is declared, and
  the DDL printer emits each source independently (inline `PRIMARY KEY` per flagged column plus a
  `PRIMARY KEY (...)` clause per constraint), so multiple declarations shipped DDL Postgres
  rejects with no error anywhere. Fixed on both paths: the runtime `Table` throws, and a new
  `MULTIPLE_PRIMARY_KEYS` validation rule covers schemas that only run migrations.
- **One PR instead of one PR per story**, so each story stays independently reviewable as a commit
  without nine merge cycles.

## Open questions

- **Story 3** — the proposal specifies a scope stack on `SQLContext`, but `SQLContext` is built
  inside `SQLQuery.toQuery()` at render time and nodes render depth-first, so a stack needs
  push/pop marker nodes. A mutable `Scope` token stamped with its alias at build time is the
  candidate alternative. Decide when the story starts.
- **Story 5** — `schema-guid.md` wants `$$meta` implemented only after
  `schema-polymorphic-relations.md` is accepted, so the union select interface is settled;
  `schema-prerequisites.md` orders it unconditionally. Confirm before starting.

## Close-out

`docs/decisions/0003-schema-prerequisites.md` on completion; delete
`.claude/proposals/schema-prerequisites.md`; renumber the guid record to `0004` and the
polymorphic-relations record to `0005`.
