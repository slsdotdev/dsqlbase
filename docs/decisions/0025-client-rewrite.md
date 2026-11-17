# 0025 — Client rewrite: `get` / `key`, `paginatedQuery`, named unions

- **Date:** 2026-11-17
- **Status:** accepted
- **Supersedes:** the client API in [0008](./0008-client-pagination.md) (`paginate`, page shape,
  `count: true`), the `$listByGlobalId` lookup and node discovery in
  [0007](./0007-global-ids.md), the `where`-pinned one-row writes in
  [0023](./0023-update-many.md), and the `union()` signature in
  [0009](./0009-polymorphic-relations.md) / [0019](./0019-declared-union-columns.md)

## Context

The client had grown around three large modules (`model/base.ts`, `model/normalizer.ts`,
`model/filters.ts`) plus a `database/` base and `union/`, `pagination/` and `transaction/`
folders. Unique-key rules were enforced at runtime by inspecting a `where`, pagination carried a
two-statement counted page, and global-id lookups lived in a separate node registry. Each
feature touched every module, and the types could not say which writes were one-row.

## Decision

- **Layout.** `client/clients/` (`BaseClient`, `DsqlClient`, `ModelClient`, `UnionClient`,
  `TransactionClient`, `withModels`), `client/normalizers/` (`RequestNormalizer`, `WhereBuilder`,
  `PaginationHandler`, operator rules, arg and result types) and `client/utils/` (OCC retry).
  `attachModels`, `DatabaseClient` and `client/nodes.ts` are gone.
- **`get({ key, select?, join? })`** reads one row by unique key. **`update({ key, set })`** and
  **`delete({ key })`** replace the `where`-pinned forms; the key is typed, so a non-key `where`
  no longer compiles. A key that matches no unique key throws before any SQL runs.
  `updateMany` / `deleteMany` keep `where`.
- **`paginatedQuery`** replaces `paginate` on models and unions. A page is
  `{ items, hasMore, nextCursor }`; each item carries `__cursor`. `count: true`, `totalCount`,
  `startCursor`, `endCursor`, `hasNextPage` and `hasPreviousPage` are removed, which also removes
  the counted page's two-statement `CompositeQuery` and its snapshot gap. Use `count()` for a
  total. The keyset predicate is built by `WhereBuilder.buildKeyset`; the cursor format, total
  order and null placement of 0008 stand.
- **Page size.** `maxLimit` defaults to 100 when unset, and `createClient` no longer validates
  `pagination`; a `limit` over the cap throws when the page is read.
- **Global ids.** `$listByGlobalId` is removed. `$findByGlobalId(id)` returns a lazy executable
  query and resolves through `RequestNormalizer`, reading `Table.uniqueKeys` at lookup time; a
  table is a node when it has a unique key. A bad table or key is a plain `Error`.
- **`union(name, { members, columns })`** takes a name, giving unions the same identity as tables.
- **`ColumnHooks.filter(value, ctx)`** unwraps a value used in a filter before encoding;
  **`writeDeps(value, ctx)`** resolves the `dependsOn` columns of a column on a write (a wrapped
  guid supplies the discriminator).

## Consequences

- **Breaking (`minor`, `dsqlbase` and `@dsqlbase/core`):** the renames and removals above;
  `update` / `delete` callers pass `key`; `paginate` callers switch to `paginatedQuery`.
- Backwards reads (`before`) remain in `PaginatedQueryArgs`; only the page shape changed.
- Rejected: keeping `count: true` on a page — a count that disagrees with the page outside a
  transaction was a standing known gap.

## Docs

- [Querying](../guide/querying.md), [Pagination](../guide/pagination.md),
  [Global ids](../guide/global-ids.md)
- [Runtime pipeline](../internals/runtime-pipeline.md), [Architecture](../internals/architecture.md)
