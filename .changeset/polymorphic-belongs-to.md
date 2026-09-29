---
"dsqlbase": minor
---

Join a belongs-to a union, with global ids keyed row by row by its discriminator.

**Joining.** A `belongsTo(union, { from, to, discriminator })` now joins. Each member's branch
also requires the discriminator to name that member, so two members holding the same key never
both match. It yields the member's row, tagged with `$$key`, or `null`.

**A dynamic node key.** The relation's `from` column is declared as a keyless `guid()`.

- **Reading.** It reads back wrapped with the member the row's discriminator names, so
  `entry.counterpartyId === entry.counterparty?.id` holds. Selecting only the id reads the
  discriminator without returning it. A `NULL` discriminator leaves the id raw.
- **Writing.** A global id fills the discriminator when it is left out, and throws
  `GlobalIdError("key_mismatch")` when it disagrees or names a table outside the union.
  A raw uuid leaves the discriminator alone.
- **Filtering.** `eq` / `neq` / `in` with global ids match on
  `(discriminator = key AND id = pk)`; raw uuids compare the id alone.

**Validated when the client is built.**

- A static key on the discriminated column throws.
- So does a member that is not a node related through its own key.
- So does a plain `uuid()` paired with the polymorphic column.
- A has-many from a member back onto it is accepted, and correlates on the id alone.

**Breaking.**

- **`@dsqlbase/core`:**
  - `Column` gains `rowDecoder` and `resolveRow()`, the guid-agnostic seam a client uses for a
    value decoded from its whole row. `_resolveFields` projects a row decoder's `dependsOn`
    columns.
  - `UnionBranchParams` gains `correlate`.
  - `SchemaRegistry` gains `getRelationDiscriminator`.
- **`dsqlbase`:** a keyless `guid()` that is the `from` side of a discriminated belongs-to is no
  longer bound as a self reference.

Docs: docs/guide/polymorphic-relations.md, docs/guide/relations.md, docs/guide/global-ids.md, docs/internals/codec-boundary.md, docs/internals/runtime-pipeline.md
