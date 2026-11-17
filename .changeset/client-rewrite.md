---
"@dsqlbase/core": minor
"dsqlbase": minor
---

`dsqlbase`:

- Client rewritten with a cleaner structure (breaking): `ModelClient.get({ key })` for unique reads; `update()` / `delete()` take `key: {...}`; `client.paginated()` is now `client.paginatedQuery()` and returns `{ items, hasMore, nextCursor }`; `$listByGlobalId` removed.
- `update` / `delete` change exactly one row; `updateMany` / `deleteMany` change every match (breaking).
- Row policies replace tenancy: `table.policy()`, `PolicyViolationError`, `createClient({ policies: { bypass } })`, per-request `sql.claim()` / `$withClaims()` (breaking: `tenantScope`, `$identityClaims` and the client tenancy generics are removed).
- `$findByGlobalId(id)` takes the id alone and resolves by any unique key (breaking).
- `guid()` takes only a column name; what its ids name comes from relations (breaking).
- `union(name, { members, columns })` declares its shared columns, and `relations()` takes a union as its source (breaking).
- Embedded objects removed (breaking).
- `guid()` columns wrap ids through column hooks.

`@dsqlbase/core`:

- `ColumnHooks` `read` / `write` / `filter` / `writeDeps`, in the new `@dsqlbase/core/resolvers` entrypoint (breaking: `ColumnRowDecoder` removed).
- `Column.references` and `Column.dependsOn` record what a column points at (breaking).
- `SchemaRegistry` is built in phases and resolves relations once (breaking: `getRelationTarget` and related helpers removed).
- `UnionDefinition` takes a name and declared columns; `UnionColumnDefinition` removed (breaking).
- `Table.uniqueKeys` lists every unique key.
- Tenancy and column-group APIs removed (breaking).
- `$onUpdate` hook receives the column itself.

Docs: docs/decisions/0025-client-rewrite.md, docs/guide/pagination.md, docs/guide/querying.md, docs/guide/global-ids.md, docs/guide/polymorphic-relations.md, docs/guide/transactions.md, docs/guide/schema.md, docs/guide/policies.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md, docs/internals/codec-boundary.md, README.md, packages/dsqlbase/README.md
