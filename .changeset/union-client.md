---
"dsqlbase": minor
---

Read a `union()` directly: `dsql.<unionAlias>.findOne`, `findMany`, `paginate` and `count`.

**Using it.** Every union in the schema is a read-only client under its own alias, next to its
members' models. It takes the same shared-level `select`, `where` (with `$$key`), `orderBy`,
`limit` and `offset`, and the same per-member `on` map, as a union join. Rows come back as each
member's own shape, tagged with `$$key`. `findOne` requires a `where`. `count` adds up one
`count(*)` per member. There are no writes: a row is written through its member's model.

**Paging.** `paginate` returns the same page shape as a table: `items` with `$$meta.cursor`,
`hasNextPage` / `hasPreviousPage`, `startCursor` / `endCursor`, and `totalCount` with
`count: true`.

- **Total order.** Rows are ordered by `orderBy`, then `$$key`, then each primary-key column by
  position. The appended keys follow the last key's direction.
- **Cursors.** They are signed against the union's alias.
- **Where the keyset applies.** Inside every member's branch, where `$$key` is a constant, so
  per-member limit pushdown stays valid.
- **Aligned keys required.** Paging needs every member's primary key to line up in arity and
  type. Otherwise `paginate` throws, and `findMany` still works.

**Visibility.** A union is shown on a client only when every member is. On an enforcing client
without claims, a union with a tenant-scoped member is absent from the type and refused at
runtime. Transaction and identity clients carry union clients like any model.

**Breaking.**

- **`@dsqlbase/core`:**
  - `UnionSelectOperationArgs` gains `tiebreak`, `keys` and `keyset`.
  - `OperationsFactory` gains `createUnionSelectOperation` and `createUnionCountOperation`, and
    `QueryBuilder` gains `buildUnionSelectQuery`.
  - `Union` gains `tiebreakers`.
  - `CountOperation.args` widens to `CountOperationArgs | UnionCountOperationArgs`.
- **`dsqlbase`:**
  - `Aliases`, `VisibleAliases` and `Models` include union aliases.
  - `shapePage` takes a `PagePlan`.

Docs: docs/guide/polymorphic-relations.md, docs/guide/querying.md, docs/guide/pagination.md, docs/guide/transactions.md, docs/guide/tenancy.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md
