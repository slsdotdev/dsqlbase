---
"dsqlbase": minor
---

Declare a set of tables that can stand in for one another with `union()`, and point relations at it.

GraphQL unions and interfaces, such as a feed mixing photos and videos, or a reference to one of
several tables, had no schema form: a relation targeted exactly one table.

**Declaring it.** `union({ photos, videos })` (from `dsqlbase/schema`) keys each member by its
schema alias. `union.columns` holds the shared fields, meaning the fields every member declares with
the same type; `SharedFieldsOf` types them. A union produces no DDL, and the migration runner
ignores it.

**Relating to it.** `hasMany`, `hasOne` and `belongsTo` accept a union target. `to` is either a
list of shared fields (`[posts.columns.userId]`), which resolve to each member's own column, or
one column list per member. A belongs-to a union also takes `discriminator`: the source column
naming which member a row points at.

**Validated when the client is built.** `createClient` throws in any of these cases:

- a member is keyed by something other than its alias, or is missing from the schema;
- the union's alias is also a table's name;
- a relation pair does not line up on some member;
- a `to` list holds something other than shared fields;
- a per-member map misses or invents a member;
- a discriminator is missing on a belongs-to a union, is present anywhere else, is not text-like, or is not on the source table.

Guid pair agreement is checked against every member.

This change does not add querying a union. Joining a relation to a union throws until union joins
land.

**Breaking.** `FieldRelation.target` widens to `AnyTableDefinition | AnyUnionDefinition`,
`FieldRelation.to` to `RelationTargetColumns<TTarget>`, and `SchemaRegistry.getRelationTarget`
now returns `AnyTable | Union`. Callers that assumed a table must narrow. `RelationsDefinition.toJSON`
serializes a union target with its members, a per-member `to` as a map, and a `discriminator`.
`Kind` gains `UNION` and `UNION_COLUMN`, and `Schema` gains `unions`.

Docs: docs/guide/schema.md, docs/guide/relations.md, docs/internals/architecture.md
