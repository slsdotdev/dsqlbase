# Decisions

_Audience: contributors and agents._

Accepted design decisions, numbered in the order they were accepted. A record is short: enough to know what was decided, why, and what it rules out — the full design lives in [`docs/internals/`](../internals/README.md). Records are never edited to change a decision; a new record supersedes the old one and both link each other.

## Index

| # | Title | Date | Status |
|---|---|---|---|
| [0001](./0001-docs-structure.md) | Root `docs/` structure for humans and agents | 2026-09-19 | accepted |
| [0002](./0002-migration-consolidation.md) | Migration module consolidation (v1 shape) | 2026-09-19 | accepted |
| [0003](./0003-select-tree-aliasing.md) | Table aliasing in select trees | 2026-09-21 | accepted provisionally |
| [0004](./0004-record-meta.md) | `$$meta` on every result row | 2026-09-22 | accepted |
| [0005](./0005-tenant-client-visibility.md) | Tenant table visibility on the client | 2026-09-23 | accepted provisionally |
| [0006](./0006-client-tenancy.md) | Application-level tenancy | 2026-09-23 | accepted |

## Template

```markdown
# NNNN — Title

- **Date:** YYYY-MM-DD
- **Status:** accepted | superseded by [NNNN](./NNNN-title.md)
- **Proposal:** `<name>.md` — the working proposal or epic under `.claude/`, which is untracked, so name it for the author's own reference and keep this record self-contained

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
