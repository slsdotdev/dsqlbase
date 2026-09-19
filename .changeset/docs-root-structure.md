---
"dsqlbase": patch
---

Correct the `QueryArgs.limit` JSDoc: no default limit is applied when `limit` is omitted (the comment previously promised a default of 100 that the code never enforced).

Docs: new root `docs/` set — `docs/README.md`, `docs/guide/*`, `docs/internals/*`, `docs/decisions/0001-docs-structure.md`, `docs/decisions/0002-migration-consolidation.md`; `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, and package READMEs now point at it.
