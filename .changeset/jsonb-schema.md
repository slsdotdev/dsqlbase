---
"@dsqlbase/core": minor
"@dsqlbase/migration": minor
"dsqlbase": minor
---

Add `jsonb()` and `.schema()` for JSON columns. `jsonb(name)` is a column of any JSON value — object, array, string, number or boolean — with `null` meaning SQL `NULL`. `.schema(s)` on `json()` and `jsonb()` takes any Standard Schema (zod, valibot, arktype; none is a dependency) and validates every write and every read: a write takes the schema's input, stores its output in JSON form (defaults filled, coercions applied) and checks that output reads back as itself, so a transforming schema throws on its first write; a read validates the stored value and returns the schema's output. Failures throw the new `ColumnValidationError` (`code`, `column`, `phase`, `issues`). A `.default()` is validated where it is declared.

Fixed: a JSON column no longer parses a value the driver already parsed. A stored JSON string such as `"123"` or `"true"` read back as a number or boolean.

Breaking:

- `@dsqlbase/core`: `ColumnConfig` gains `inputType` (a fourth type parameter, defaulting to the value type). `.default()`, `$onCreate`, `$onUpdate`, `getInsertValue` and `getUpdateValue` take the input type. `ValueType` (`$type<T>()`) sets both.
- `dsqlbase`: `CreateValuesOf` / `UpdateValuesOf` use the input type.
- `dsqlbase`: a JSON column's decode returns what the session returned. A custom `Session` must return `json` / `jsonb` columns parsed, as `pg` and PGlite do.
- `dsqlbase`: `json()` returns a `JsonColumnDefinition`; its raw type is `unknown`.

Docs: docs/guide/schema.md, docs/guide/querying.md, docs/internals/codec-boundary.md
