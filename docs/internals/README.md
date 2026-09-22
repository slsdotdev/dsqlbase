# Internals

_Audience: contributors and agents changing `dsqlbase`._

Read this directory before proposing or implementing anything. Every page cites code by path so you can jump from the doc to the source.

## Read before proposing

1. [Architecture](./architecture.md) — which package owns what, and the dependency direction you must not invert.
2. [Runtime pipeline](./runtime-pipeline.md) — the chain every client feature threads through, and its known gaps. **Gaps are deficiencies to fix, not constraints to design around**: when a feature needs one fixed, the fix is a prerequisite story in the proposal.
3. [Codec boundary](./codec-boundary.md) — where values are encoded/decoded and where they are not.
4. [Select-tree aliasing](./select-tree-aliasing.md) — why every select level is aliased, and how one predicate references the same table under two aliases.
5. [Migration pipeline](./migration-pipeline.md) — invariants that hold across the diff / operations / planner / runner layers.
6. [DSQL capabilities](./dsql-capabilities.md) — the verified DDL table. Cite it, do not restate DSQL rules from memory.
7. [Conventions](./conventions.md) — tooling rules, the proposal workflow, and the documentation definition of done.
8. [Testing](./testing.md) — commands and test conventions.

## Where design lives

| Stage | Location |
|---|---|
| Draft design | `.claude/proposals/<name>.md` (untracked working notes) |
| Multi-story work in progress | `.claude/epics/<name>.md` (untracked working notes) |
| Accepted and implemented | condensed into [`docs/decisions/`](../decisions/README.md); durable design text moves into this directory; proposal deleted |

## Related

- [Docs index](../README.md)
- [Guide](../guide/README.md) — the consumer view of the same features
