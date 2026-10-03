---
"@dsqlbase/migration": patch
"@dsqlbase/core": patch
---

Migrations create, alter, rename and drop objects declared with `namespace()` in their own schema. Before, most statements named a namespaced table bare, so `CREATE TABLE` landed in `public` and the next plan dropped it as an object the definition lacked; `CREATE INDEX` named its table as a single quoted identifier (`"app.widgets"`) and failed; and domain and sequence drops ignored the schema. Every statement on a table, index, sequence or domain is now schema-qualified outside `public`, so no plan depends on `search_path`.

A column typed by a domain in a namespace serializes its `domain` as `namespace.name` and its `dataType` schema-qualified (`"app"."email"`). Introspection reads it the same way, and the column diff compares a domain column by its domain, not by how each side spells the type, so a second plan is empty.

Docs: docs/guide/migrations.md (Namespaces), docs/internals/migration-pipeline.md (Operations).
