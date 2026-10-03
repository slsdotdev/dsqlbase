---
"dsqlbase": minor
"@dsqlbase/core": minor
---

JSON columns: `jsonb()`, `array()` and `record()`, validated by any Standard Schema.

- **`jsonb(name)`** holds any JSON value; `null` is SQL `NULL`. **`array(name)`** and **`record(name)`** are `jsonb` columns whose value must be an array or a plain object, checked on every write and read.
- **`.schema(s)`** on `json()`, `jsonb()`, `array()` and `record()` takes any Standard Schema (zod, valibot, arktype — none is a dependency). Writes validate and store the schema's output; reads validate and return it. A failure throws `ColumnValidationError` (`code`, `column`, `phase`, `issues`). `$type<T>()` types a column without validating.
- **Filters:** `jsonb`, `array` and `record` filter by `eq` / `neq` (whole documents), `contains` (`@>`, a fragment matched recursively; on an array, a list of item fragments) and `exists`; a record also by `hasKey` (`?`). `json` filters by `exists` only, as Postgres's `json` has no equality. `distinct` compares `jsonb`.
- **Validators** run beside a column's codec: `ColumnConfig.validator { write, read }` runs on every write (`.default()`, `$onCreate`, `$onUpdate` included) and every read; filter values are only encoded.
- **Fixed:** a JSON string such as `"123"` stored in a JSON column read back as the number `123`.

**Breaking:**

- `array()` is now `jsonb`, not comma-joined `text`, and untyped it reads as `unknown[]`. An existing `array()` column can't change type in place on DSQL; the migration refuses it.
- A custom `Session` must return `json` / `jsonb` columns parsed, as `pg` and PGlite do.
- `@dsqlbase/core`: `ColumnConfig` gains an `inputType` parameter; `.default()`, `$onCreate` and `$onUpdate` take the input type.

Docs: docs/guide/schema.md, docs/guide/querying.md, docs/internals/codec-boundary.md, docs/decisions/0011-json-columns.md, docs/decisions/0012-json-array-record.md
