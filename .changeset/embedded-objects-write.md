---
"@dsqlbase/core": minor
"dsqlbase": minor
---

Column groups are written as objects of their members. `create` writes the members given and lets the rest take their `$onCreate` or default; a group is required when it has a required member and no `.default(obj)`. `update` writes only the members given. `null` sets every column of a group `NULL`, and only a group whose members are all nullable takes it. Members' `$onUpdate` hooks run on every update, and a `guid()` member takes a global id or a raw uuid.

Core inserts every real column of a table, a group's members included, and runs `$onUpdate` over them.

Breaking, in `@dsqlbase/core`: `FieldMutation`'s first element is a field name or a column (`[target: string | AnyColumn, value]`); a column given directly must belong to the table.

The client adds `GroupInputOf` and `GroupUpdateOf`; `CreateValuesOf` and `UpdateValuesOf` gain group branches (additive).

Docs: docs/guide/embeddable-objects.md, docs/guide/querying.md, docs/guide/global-ids.md, docs/internals/runtime-pipeline.md
