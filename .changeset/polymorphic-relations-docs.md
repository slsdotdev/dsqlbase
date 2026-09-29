---
"dsqlbase": patch
---

Document polymorphic relations in the package README and record the design.

No runtime change. Adds a "Polymorphic relations" section to the `dsqlbase` README, covering
`union()`, a union join with `on` and `$$key`, the union client, and the discriminated belongs-to.
Also records the design as decision 0009, whose rejected alternatives are carried over from the
working proposal, and notes in 0004 and 0007 where their forward promises were resolved. The
PGlite e2e suite gains a polymorphic fixture and `polymorphic.spec.ts`.

Docs: docs/decisions/0009-polymorphic-relations.md, docs/decisions/README.md, docs/decisions/0004-record-meta.md, docs/decisions/0007-global-ids.md, README.md, packages/dsqlbase/README.md
