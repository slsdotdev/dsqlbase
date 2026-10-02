---
"dsqlbase": patch
---

Move the `where` language into one client module, `client/model/filters.ts`: the runtime-type operator table (formerly `operators.ts`), the filter types (`FilterCondition`, `FilterOf`, `ColumnFilterOf`, `WhereExpressionOf`, `isFilterType`, formerly in `base.ts`) and a `WhereBuilder` the normalizer holds and builds every `where` with. No behaviour change; the public exports are the same.

Docs: docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, docs/internals/architecture.md, docs/decisions/0011-json-columns.md
