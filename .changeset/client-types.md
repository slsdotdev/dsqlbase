---
"dsqlbase": minor
"@dsqlbase/core": minor
"@dsqlbase/migration": minor
---

Types and the model surface:

- **Relations split across several `relations()` blocks are typed;** a table with two blocks had no relation names at the type level, though its queries ran.
- **One model per table, under its schema alias.** A table exported as `members` but named `team_members` also appeared as `dsql.team_members` when the client was indexed dynamically; that duplicate is gone. `Table.alias` holds the alias.
- **Exported object types are `type` aliases,** so they can no longer be extended by declaration merging (`declare module "dsqlbase" { interface QueryArgs … }`).

**Breaking:** the two behaviour changes above.

Docs: docs/guide/relations.md, docs/internals/runtime-pipeline.md
