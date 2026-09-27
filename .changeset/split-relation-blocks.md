---
"@dsqlbase/core": patch
---

Relations split across several `relations()` blocks are typed.

The registry has always merged every `relations()` block declared for one table, refusing a name declared twice. The types did not: `DefinitionTableRelations` produced one relation map per block, as a union, and `keyof` a union keeps only the keys every member shares. A table with two blocks therefore had no relation names at all — `join` results on it were typed `never`, while the queries ran correctly. The blocks are now merged at the type level too.

Types only; no runtime change, and nothing previously typed correctly changes. A new `npm run typecheck` runs `tsc --noEmit` over `packages/tests` in CI — its specs were never type-checked, which is how this went unseen.

Docs: docs/guide/relations.md, docs/internals/testing.md, CLAUDE.md
