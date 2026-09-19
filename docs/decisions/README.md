# Decisions

_Audience: contributors and agents._

Accepted design decisions, numbered in the order they were accepted. A record is short: enough to know what was decided, why, and what it rules out — the full design lives in [`docs/internals/`](../internals/README.md). Records are never edited to change a decision; a new record supersedes the old one and both link each other.

## Index

| # | Title | Date | Status |
|---|---|---|---|
| [0001](./0001-docs-structure.md) | Root `docs/` structure for humans and agents | 2026-09-19 | accepted |
| [0002](./0002-migration-consolidation.md) | Migration module consolidation (v1 shape) | 2026-09-19 | accepted |

## Template

```markdown
# NNNN — Title

- **Date:** YYYY-MM-DD
- **Status:** accepted | superseded by [NNNN](./NNNN-title.md)
- **Proposal:** `.claude/proposals/<name>.md` (deleted on acceptance) or epic path

## Context
Why a decision was needed. Two to five sentences.

## Decision
What was decided. Bullets are fine.

## Consequences
What this enables, what it forecloses, what it costs. Include breaking changes and changeset level.

## Docs
Which `docs/internals/` and `docs/guide/` pages carry the design.
```

## Related

- [Conventions → Design workflow](../internals/conventions.md#design-workflow)
