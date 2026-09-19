---
proposal: docs
status: accepted
owner: silviu
created: 2026-09-19
---

# Root `docs/` set for humans and agents

## Problem

`dsqlbase` is consumed by a real application and worked on by agents, but its documentation is scattered, partly stale, and has no single entry point. Audit on 2026-09-19 against `main` (`58fdc27`):

| Location | Covers | Problems |
|---|---|---|
| `README.md` | Motivation, showcase, migration pipeline outline | "Immutable columns / cannot drop columns" is false per current DSQL docs; says migrations have no public interface (`createMigrationRunner` is exported); nothing on sessions or transactions |
| `CONTRIBUTING.md` | Issues, PRs, local dev, changesets | No mention of proposals, epics, or docs |
| `packages/dsqlbase/README.md` | Install + quickstart | Stale constraint sentence; "full docs" link goes to a showcase |
| `packages/core/README.md`, `packages/migration/README.md` | Install only | `migration` README calls itself internal; it is published |
| `CLAUDE.md` | Commands, architecture, conventions | Architecture describes `packages/schema` / `packages/client` (gone), calls `dsqlbase` a placeholder, wrong dependency direction |
| `.claude/epics/migration.md` | Invariants, DSQL rules, story history | Paths point at `packages/schema/src/migration`; "Refused" table predates the current `ALTER TABLE` grammar; Story 6 "one failing test" is stale |
| `.claude/prime/00-review.md` | Runtime pipeline, codec boundary, verified DSQL capability table | Gitignored — the most accurate architecture text is not tracked |
| JSDoc on `QueryArgs` (`packages/dsqlbase/src/client/model/base.ts`) | Query args | Claims a default limit of 100; the operations factory applies none |
| `.claude/proposals/` | — | Referenced everywhere; did not exist until this proposal |

Design knowledge lives in conversations and gets lost. Prompts 02–04 (schema, client, migrations) require every proposal to name the docs pages it changes, so the structure has to exist first.

## Decision

**Structure A: two audience trees plus a decisions log**, plain markdown, tracked at the repo root.

1. **Separate trees.** `docs/guide/` for consumers, `docs/internals/` for contributors and agents, `docs/decisions/` for accepted designs. Consumers never have to read about the codec boundary; agents can be pointed at one directory.
2. **Proposal lifecycle.** Proposals are drafts in `.claude/proposals/`. Once accepted and implemented, the durable design text moves into `docs/internals/`, a condensed record lands in `docs/decisions/NNNN-title.md`, and the proposal file is deleted — the pattern the migration epic already used for its nine proposals.
3. **`CLAUDE.md` shrinks** to the commands table, agent-only rules, and a pointer at `docs/internals/`. Humans and agents read the same architecture text.
4. **Plain markdown**, generator-compatible: a `README.md` index per directory, relative links, no front-matter magic. No VitePress or typedoc while the public API is moving; the layout can be imported into a generator later without moving files.
5. **Freshness rule** (definition of done below): changeset `Docs:` line plus proposal/story rule. No CI check yet.
6. **First pass** = structure plus migration of content that already exists. Missing consumer guides are stubs that state their intended contents and land with the 02–04 work.

### Rejected

- **B. Single flat tree by topic** — each page carrying both audiences mixes internals into consumer pages, and a later split is a rewrite of every page.
- **C. Generated site now** (VitePress + typedoc) — best reading experience, but adds dependencies, a build, and a deploy while the API churns; typedoc output would be regenerated on every 02–04 change.
- **D. README-only expansion** — already 149 lines; one page cannot host internals or decisions, and package READMEs would keep diverging.
- **E. Per-package `docs/`** — colocated with code but no home for cross-package pages (runtime pipeline, DSQL capability table), and consumers who install only `dsqlbase` would never see the others.

## Layout and page list

```
docs/
  README.md                          index: who reads what, page map, page conventions
  guide/                             consumers
    README.md                        entrypoint map, where to start                       migrated
    install.md                       packages, peer deps, Node/npm                          migrated
    schema.md                        table(), column types, domain/$enum/sequence/namespace migrated
    relations.md                     relations(), hasMany/hasOne/belongsTo, runtime-only    migrated
    querying.md                      createClient, models, QueryArgs surface, $execute/$raw migrated
    sessions.md                      Session, createPgSession, createPgLiteSession, BYO     stub
    transactions.md                  $transaction, TxClient, OCC retry                       stub
    migrations.md                    runner surface, options, PGlite vs DSQL flags           migrated
    dsql-notes.md                    what DSQL changes for you, corrected constraint list    migrated
  internals/                         contributors and agents
    README.md                        read-before-proposing list                              new
    architecture.md                  workspaces, dependency direction, entrypoints, dirs     migrated (from CLAUDE.md, corrected)
    runtime-pipeline.md              ModelClient → normalizer → operations → query → session migrated (from 00-review)
    codec-boundary.md                where codecs apply and where they do not                migrated (from 00-review)
    migration-pipeline.md            invariants, diffs/operations/planner/runner              migrated (from epic)
    dsql-capabilities.md             verified DSQL DDL table with URLs and date               migrated (from 00-review + epic)
    testing.md                       per-package test commands, e2e, test conventions        migrated (from CLAUDE.md + memory)
    conventions.md                   TS/ESLint/Husky/changesets, proposals, docs DoD         migrated (from CLAUDE.md)
  decisions/                         accepted designs
    README.md                        what a record is, numbering, template                   new
    0001-docs-structure.md           this decision                                           new
    0002-migration-consolidation.md  condensed from .claude/epics/migration.md               new
```

## Definition of done for future work

These rules apply to every proposal, story, and PR from now on.

1. **Every proposal ends with a `## Docs` section** listing: the `docs/guide/` pages to add or change; the `docs/internals/` pages to add or change; the decision record to add under `docs/decisions/` once accepted; any `CLAUDE.md` or package-README lines that become stale.
2. **Every implementation story names the docs pages it changes.** A story is not done until those pages are updated in the same PR.
3. **Every changeset body carries a `Docs:` line** naming the pages touched, or `Docs: none — <reason>`.
4. **A change that alters a documented claim fixes the doc in the same change** (the "default limit 100" JSDoc is the canonical example).
5. **Accepted proposals are condensed** into `docs/decisions/NNNN-title.md`; durable design text moves to `docs/internals/`; the proposal file is deleted.

## Page conventions

- Cite code by path (`packages/dsqlbase/src/client/model/base.ts`), never by line number — lines rot, paths are greppable.
- Any DSQL capability claim carries the AWS doc URL and a `Verified: YYYY-MM-DD` line.
- Every page starts with an `_Audience_` line and ends with a `## Related` list of sibling pages.
- Stubs carry a `> **Status: stub**` callout followed by the intended contents and the code paths they will document.
- Nothing consumer-specific: needs are phrased generally ("a multi-tenant application"), never by application name.

## `CLAUDE.md` changes

Keep: project paragraph (corrected to four workspaces), commands table, tooling constraints. Replace the Architecture section with a pointer at `docs/internals/README.md`. Replace Conventions with agent-only rules: proposals before non-trivial work, epics location, the docs definition of done (short form linking `docs/internals/conventions.md`), changesets, Husky. Target ≤ 60 lines.

## Out of scope

- Writing the missing guides (sessions, transactions, runner walkthrough) — stubs only.
- VitePress/typedoc, a CI docs check, a PR template.
- Re-verifying DSQL docs — the table is copied as verified 2026-09-19; the migrations prompt owns the next audit.
- Tracking `.claude/prime/` in git.

## Docs

Created: every page in the layout above. Changed: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `packages/{core,dsqlbase,migration}/README.md`, header note on `.claude/epics/migration.md`, `limit` JSDoc in `packages/dsqlbase/src/client/model/base.ts`. Decision record: `docs/decisions/0001-docs-structure.md`.
