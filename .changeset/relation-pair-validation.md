---
"dsqlbase": minor
---

Validate relation column pairs when the client is built.

`SchemaRegistry` now checks every relation in the schema and throws from `createClient` when one is malformed:

- `from` and `to` must be non-empty and the same length.
- Each column must be declared on the side it is listed under. The check is by identity, not name, so `from: [otherTable.columns.id]` on a table that also has an `id` column is rejected rather than silently correlating the wrong column.
- Both columns of a pair must have the same `dataType`.

Breaking: a schema with a mismatched relation now fails at `createClient` instead of producing a wrong or failing query later. Relations that pair equal-length, same-typed columns from the right tables are unaffected.

Correlating over every pair already landed with select-tree aliasing; this closes the remaining half by catching the malformed cases up front.

Docs: docs/internals/runtime-pipeline.md, docs/guide/relations.md
