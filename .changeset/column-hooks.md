---
"@dsqlbase/core": minor
"dsqlbase": patch
---

Column hooks: `ColumnConfig.hooks { read, write }` transform a column's values around its codec with what a codec cannot see — the runtime column and, on a read, the row. Only the runtime `Column` runs them (`write` before encode, on writes and filters; `read` after decode), never a definition's `.default()`, so codecs stay pure. `ColumnCodec`, `defaultCodec`, `ColumnValidator`, `ColumnHooks` and `ColumnHookContext` live in the new `@dsqlbase/core/resolvers` entrypoint, and are exported from the root. `validateSchema` refuses a relation pair whose columns carry different hooks, a column with hooks that references more than one target or reaches a union member through a column that is not a unique key, and a ring of references.

**Breaking (`@dsqlbase/core`):**

- `ColumnRowDecoder`, `Column.rowDecoder` and `Column.resolveRow` are removed — use a `read` hook, which gets the row; `Column.resolve(raw, row?)` takes it;
- `ColumnCodec`, `defaultCodec` and `ColumnValidator` are no longer exported from `@dsqlbase/core/definition` — import them from `@dsqlbase/core` or `@dsqlbase/core/resolvers`;
- a ring of references is refused for every column: a `hasOne` declared from the table that holds the key, beside a relation the other way, now throws — declare it as a `belongsTo`.

Docs: docs/decisions/0022-column-hooks.md, docs/internals/codec-boundary.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md
