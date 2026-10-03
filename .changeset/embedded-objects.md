---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Embedded objects: `embedded({ amount, currency })` declares a reusable value object, and `.column("net_value")` places it in a table as a column group — one column per member (`net_value_amount`, …), each with its own type, codec, validator and `.notNull()`. Groups nest and take `.default(obj)`.

- **Reading:** a group reads as a nested object; `select` takes it as `true` or a map of its members. A group whose members are all nullable reads `null` when every column is `NULL`.
- **Writing:** `create` writes the members given, `update` only the members given, and `null` clears an all-nullable group.
- **Filtering and ordering:** a group takes `exists` and a nested `where` over its members; `orderBy` and `paginate` take a nested order per group.
- Constraint and index callbacks reach members as `c.netValue.amount`. Migrations see plain columns.

**Breaking,** for `@dsqlbase/core` callers: `Table.getColumn` returns a `Column` or a `ColumnGroup`, and table column maps accept groups.

Docs: docs/guide/embeddable-objects.md, docs/guide/schema.md, docs/guide/querying.md, docs/decisions/0013-embeddable-objects.md
