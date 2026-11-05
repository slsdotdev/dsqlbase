---
"@dsqlbase/core": minor
"dsqlbase": patch
---

`SchemaRegistry` is built in three steps: `validateSchema` (pure checks over the definition, same messages as before), `buildSchema` (runtime tables, unions and resolved relations, with column references linked from them), and the registry itself, which only looks things up. Relations are resolved once: `getRelation(table, field)` returns a `RuntimeRelation` with runtime columns on both sides, its target, and, to a union, per-member columns and discriminator. A relation through a deprecated column is now refused when the client is built.

**Breaking (`@dsqlbase/core`):**

- `getRelationTarget`, `getUnionRelationColumns`, `getRelationDiscriminator` and `hasRelations` are removed — use `getRelation(table, field)`;
- `getRelations(table)` returns `RuntimeRelation`s, and is empty for a table with none;
- `Table.relations`, `Table.getRelation` and `Table.hasRelation` are removed, and the `Table` constructor is `(definition, alias?)`;
- `ColumnReference.via` is the `RuntimeRelation` that set it.

Docs: docs/decisions/0021-schema-registry-phases.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md
