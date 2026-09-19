# 0001 — Root `docs/` structure for humans and agents

- **Date:** 2026-09-19
- **Status:** accepted
- **Proposal:** `.claude/proposals/docs.md`

## Context

Documentation was spread across a README showcase, a short CONTRIBUTING, near-empty package READMEs, a stale `CLAUDE.md`, one epic, and JSDoc — with the most accurate architecture text living in a gitignored review file. The schema, client, and migrations proposals all need to name the docs pages they change, so a structure had to exist first.

## Decision

- A root `docs/` with three trees: `guide/` (consumers), `internals/` (contributors and agents), `decisions/` (this log). Plain markdown, a `README.md` index per directory, no site generator or typedoc yet.
- `CLAUDE.md` shrinks to commands, agent rules, and a pointer at `docs/internals/`; humans and agents read the same architecture text.
- Proposals draft in `.claude/proposals/`; on acceptance the design moves to `internals/`, a record lands here, and the proposal is deleted.
- Freshness is enforced by rule, not CI: a `## Docs` section in every proposal, docs pages named in every story, a `Docs:` line in every changeset.
- First pass migrated existing content only; missing guides are stubs.

Rejected: a single flat tree (mixes audiences), a generated site now (tooling while the API churns), README-only (cannot host internals), per-package docs (no home for cross-package pages).

## Consequences

- Every future PR that touches a published package must name docs pages in its changeset.
- Package READMEs become pointers; the root README is a showcase plus links.
- Moving to VitePress later requires no file moves.
- No CI enforcement yet; if the rule is not followed, a check is the next step.

## Docs

- `docs/README.md`, `docs/internals/conventions.md` (Documentation section).
