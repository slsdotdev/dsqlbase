---
"@dsqlbase/core": minor
"dsqlbase": patch
---

A runtime `Column` now records what it points at. `SchemaRegistry` sets `Column.references` on every foreign-key column while it validates relations — the `from` of a belongs-to, the `to` of a has-many / has-one — for every column type, and freezes them once built. `Column.dependsOn` is the discriminator of a belongs-to a union, projected with the column whenever it is selected; `Column.resolveReferences()` follows references to where each chain ends and reports a ring instead of looping.

The client binds `guid()` columns from these references instead of walking every relation itself. Behaviour is unchanged, except that two relations whose chains end at the same column (`orders.customerId` → `customers.id`, and → `customerStats.customerId` → `customers.id`) are accepted.

**Breaking (`@dsqlbase/core`):**

- `ColumnRowDecoder.dependsOn` is removed; the dependencies come from `Column.dependsOn`;
- a plain-`uuid` belongs-to a union now also selects its discriminator column (not emitted as a field).

Docs: docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, docs/internals/architecture.md
