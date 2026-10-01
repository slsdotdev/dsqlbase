---
"@dsqlbase/core": minor
"dsqlbase": patch
---

Separate validation from the codec. A column may now carry a `ColumnValidator { write, read }` (`ColumnConfig.validator`, `Column.validator`) beside its codec: writes — insert, update, `$onCreate`, `$onUpdate`, `.default()` — run `validator.write` and then encode; reads, root, joined and through a row decoder, decode and then run `validator.read`. Filters and `Column.param` only encode, so a filter value is never validated: it is compared with stored values and may be only a fragment of one. `.schema()` on `json()` / `jsonb()` now installs a validator instead of replacing the codec; a JSON column's codec is always `JSON.stringify` / identity. Behaviour on writes and reads is unchanged.

Docs: docs/internals/codec-boundary.md, docs/guide/schema.md, docs/internals/architecture.md (also drops the stale `utils/json.ts` from the `schema/utils` list)
