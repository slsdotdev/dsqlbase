---
"@dsqlbase/core": minor
---

Breaking: remove `IndexColumnDefinition.sort()` and `sortDirection` from its `toJSON()`. Aurora DSQL refuses `ASC` / `DESC` on index keys (`specifying sort order not supported for index keys`), so an index declared `DESC` could never be created. `nullsFirst()` / `nullsLast()` are unchanged.

Docs: docs/internals/dsql-capabilities.md
