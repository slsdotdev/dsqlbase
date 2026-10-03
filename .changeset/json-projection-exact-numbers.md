---
"@dsqlbase/core": patch
"dsqlbase": patch
---

`bigint` values read through a relation — a joined row, or any row of a `union()`, read directly or joined — keep their exact value. Those rows reach the client as JSON, which has no exact integer type: `9007199254740993n` came back as `9007199254740992n`. Columns of type `bigint` or `numeric` are now carried as text inside those rows, so their codec receives the same exact string a top-level read gets.

Docs: docs/internals/codec-boundary.md (Joined and union rows).
