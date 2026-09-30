---
"dsqlbase": patch
---

Document relations in `select` in the package README and record the design.

No runtime change. The README's quickstart shows a relation selected like a field, beside a `join` that carries a relation's own order and limit. The design is recorded as decision 0010, which also keeps the deferred joins work (filtered relations, `count` joins, ad-hoc entries, callback `where`) with the reasoning to start from; 0003 and 0006 note where their forward references now stand. The PGlite e2e suite gains `relation-select.spec.ts` and an isolation spec for a relation reached through `select`.

Docs: docs/decisions/0010-relation-select.md, docs/decisions/README.md, docs/decisions/0003-select-tree-aliasing.md, docs/decisions/0006-client-tenancy.md, packages/dsqlbase/README.md
