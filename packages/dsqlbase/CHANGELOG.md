# dsqlbase

## 0.2.0

### Minor Changes

- 4ab9506: Declare a tenant boundary in the schema and let the client enforce it.

  Aurora DSQL has no row-level security, so an ORM is the last place a multi-tenant application
  can be stopped from reading or writing across tenants. This applies the boundary below the point
  where queries are written, rather than offering something to remember to call.

  **Declaring it.** `tenantScope(claims)` (from `dsqlbase/schema`) defines the claim columns every
  table in one boundary carries. `ws.table(name, cols)` merges them in; `ws.columns()` spreads into
  any other constructor, including a namespaced one. Claim columns must be `notNull`, may not be
  redeclared by a table, and one claim name must have the same type wherever it appears. They are
  ordinary columns in the emitted DDL — no foreign key, no index, nothing new in a migration.

  **Using it.** `dsql.$identityClaims(claims)` derives a scoped client for the life of a request.
  Declared claims are picked out of the argument, so a decoded token can be handed over whole; a
  declared claim given as `null` or `undefined` throws. Every read the scoped client builds carries
  `workspace_id = $1` ahead of the caller's own `where`, at the root and at every joined level, and
  `create` fills the column from the claim.

  **Enforcing it.** `createClient({ tenancy: { enforce: false } })` lets an internal process run
  unscoped. On the default enforcing client a tenant table is absent from the type and throws
  `TenancyError` when a query is built — including through a join, which the types cannot see
  because a nested level is named by a relation rather than by the client. Inserting requires
  claims in **both** modes: the column is `notNull` and nothing else can fill it. Moving a row
  between tenants is `$query` on an unscoped client, deliberately.

  A scoped client has no `$query`, `$execute` or `$identityClaims`: raw SQL bypasses the predicate,
  and claims are set in exactly one place. `$transaction` inherits the scope, and a scoped query
  batched into an unscoped transaction keeps its predicate, because its SQL was fixed when it was
  built.

  **Breaking.** A schema that adopts `tenantScope` immediately loses direct access to those tables
  on a default client — that is the point, and the reason `enforce` defaults to `true`. Two schemas
  that used to build now throw: one claim name with two data types across tables, and a claim
  column that is not `notNull` and read-only. `ExecutionContextOptions` gains `identity` and
  `tenancy`, `Kind` gains `TENANT_SCOPE`, and `QueryClient` / `Models` gain defaulted generics —
  all source-compatible.

  Also fixes a bug this surfaced: a `SchemaRegistry` could not be built twice from one schema
  object when that schema split its relations across two `relations()` declarations, because the
  merge wrote into the definition. Two clients over one schema now works.

  Docs: docs/guide/tenancy.md, docs/guide/schema.md, docs/guide/querying.md, docs/guide/relations.md, docs/guide/transactions.md, docs/guide/README.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md, docs/internals/codec-boundary.md, docs/decisions/0005-tenant-client-visibility.md, docs/decisions/0006-client-tenancy.md, packages/dsqlbase/README.md

- 6875231: Encode where-clause values through the column's codec.

  `Column.param(value)` wraps a value as a parameter encoded by that column's codec, and the normalizer routes `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `between` and the bare-value shorthand through it — for `where`, `update.where` and `delete.where` alike. Filters now agree with what inserts and updates write, instead of relying on the driver to coerce JS values the same way.
  - `beginsWith` / `endsWith` / `contains` stay raw: they build a `LIKE` pattern, not a column value.
  - A value that is already an `SQLNode` passes through unencoded, so a column reference or sub-expression is never mangled.
  - `sql.eq(column, value)` and the rest of `sql.*` are unchanged and still raw. `column.param(value)` is the way to filter a codec column from `$query`.

  Breaking: the wire format of filter values changes for columns with a non-identity codec — `date`, `datetime`, `bigint`, `interval`. `pg` and PGlite coerce `Date` and `bigint` themselves, so those columns behaved correctly before and behave correctly now; the change matters for codecs that rewrite the value and for sessions that do not coerce. A custom `Session` that relied on receiving raw JS values will see encoded ones.

  Docs: docs/internals/codec-boundary.md, docs/internals/runtime-pipeline.md, docs/guide/querying.md

- 6875231: Reject two fields that map to the same database column.

  ```ts
  table("users", {
    name: text("display_name"),
    displayName: text("display_name"), // throws
  });
  ```

  Previously the second field silently won: `Table.getColumn(name)` returned whichever it found first, the result resolver reads each row by column name so one field shadowed the other, and `toJSON` emitted the column twice — producing invalid `CREATE TABLE` DDL.

  `TableDefinition` now throws when the table is declared, naming both fields. A matching `DUPLICATE_COLUMN_NAME` validation rule covers the migration path, since `validate` also accepts a `SerializedSchema` that never went through the builders.

  Breaking: a schema that relied on the shadowing now fails at declaration time.

  Docs: docs/guide/schema.md, docs/internals/migration-pipeline.md

- 6875231: Reject a relation that shares a name with a column on the same table.

  Columns and relations are one field namespace: `select`, `join` and the keys of a result row all address them as fields of the same model, so a name can only mean one of them. Nothing checked this before, and `QueryResultOf` would intersect the column's type with the joined row's.

  `createClient` now throws, naming both:

  ```
  Relation "author" on table "articles" collides with a column of the same name.
  Columns and relations share one field namespace on a table.
  ```

  Breaking: a schema with a colliding relation name now fails at `createClient`.

  Docs: docs/guide/relations.md, docs/guide/schema.md, docs/internals/runtime-pipeline.md

- 0927824: Add `$$meta` to every result row, and `table().meta()` to put your own data in it.

  The result resolver could turn a driver row into an object of decoded columns and nothing else: a nested branch of the tree was a bare array of field resolvers, so when it recursed into `user.workspace` it had no way to know the rows came from `workspaces`. Anything per-row that depends on which table a row came from was impossible below the top level.
  - Every result record now carries `$$meta` — `{ key, table, schema? }` plus whatever `table().meta()` declared. `key` is the schema alias (`members`), `table` the database name (`team_members`). Present on `findOne` / `findMany` rows, on each level of a join, and on `return` rows from `create` / `update` / `delete`.
  - `table("tasks", { … }).meta({ __typename: "Task" })` declares extra fields and types them on the row. Metadata is excluded from `toJSON`, so it never reaches a migration.
  - Each join level reports its own table, not its parent's. An absent `belongsTo` stays `null` and an empty `hasMany` stays `[]` — no row, no meta.
  - `$$meta` is an ordinary enumerable property, first key on the record, so it survives `{ ...row }` and `JSON.stringify`.
  - The resolver gained a third entry kind, `MetaResolver = [fieldName, (row) => value]`, alongside the column and nested-level kinds. It receives the raw driver row, before codec decoding. `FieldResolver`'s nested branch widens from `FieldResolver[]` to `ResolverEntry[]`; its own meaning is unchanged.

  Breaking: result rows gain a property, so a whole-row `toEqual` now needs `$$meta`. `$$meta` and `$$key` are reserved field names — a column of either throws at definition time, a relation of either when the client is created. A `table().meta()` key colliding with `key` / `table` / `schema` throws.

  Docs: docs/guide/querying.md, docs/guide/schema.md, docs/guide/relations.md, docs/internals/runtime-pipeline.md

- 6875231: Validate relation column pairs when the client is built.

  `SchemaRegistry` now checks every relation in the schema and throws from `createClient` when one is malformed:
  - `from` and `to` must be non-empty and the same length.
  - Each column must be declared on the side it is listed under. The check is by identity, not name, so `from: [otherTable.columns.id]` on a table that also has an `id` column is rejected rather than silently correlating the wrong column.
  - Both columns of a pair must have the same `dataType`.

  Breaking: a schema with a mismatched relation now fails at `createClient` instead of producing a wrong or failing query later. Relations that pair equal-length, same-typed columns from the right tables are unaffected.

  Correlating over every pair already landed with select-tree aliasing; this closes the remaining half by catching the malformed cases up front.

  Docs: docs/internals/runtime-pipeline.md, docs/guide/relations.md

- 6875231: Expose the primary key at runtime and enforce that a table has only one.
  - `Table.primaryKey: AnyColumn[]` (key order, empty when none) and `Table.isCompositeKey` on `@dsqlbase/core`'s runtime `Table`. Built from whichever source declares the key — the column-level `.primaryKey()` flag or a table-level `primaryKey((c) => [...])` constraint, which was previously invisible at runtime.
  - **Breaking:** declaring more than one primary key now throws when the client is created, and is reported as `MULTIPLE_PRIMARY_KEYS` by the migration validator. Two flagged columns, a flagged column alongside a table-level constraint, and two table-level constraints were all accepted before and emitted DDL Postgres rejects (`multiple primary keys for table "x" are not allowed`), because the DDL printer prints each source independently. A composite key is one constraint over several columns.
  - **Fix:** `PrimaryKeyConstraintDefinition.include()` assigned `_columns` instead of `_include`, so it replaced the key columns with the included ones and always serialized `include` as `null`. Since the migration pipeline supports `INCLUDE` on primary keys end to end, this emitted the wrong `PRIMARY KEY`.

  Docs: docs/internals/runtime-pipeline.md, docs/internals/migration-pipeline.md, docs/guide/schema.md

- 6875231: Alias every level of a select tree, so a relation can point at the table it comes from.

  A join renders as `LEFT JOIN LATERAL` over a sub-select whose `FROM` re-declared the same correlation name as the outer query. Postgres resolved both sides of the join predicate to the inner table, so the correlation silently collapsed — a `tasks.parent → tasks` relation produced `WHERE "tasks"."parent_id" = "tasks"."id"`, matching each row against itself. The same collapse hit two different tables that share a name across schemas.
  - Every select level now renders `FROM <table> AS "__t<n>"`, and each lateral join's JSON wrapper gets its own `"__j<n>"` instead of the fixed `"__t"` they all shared. Columns qualify against the alias bound for their level.
  - Self-referential relations and joins between same-named tables in different schemas are correct. Sibling joins to one table at a single level were never affected.
  - The join correlation is built by `QueryBuilder`, which is the only layer that knows what each level is aliased as. `JoinParams.from` / `to` are now `SQLNode[]` and correlate over every column pair.

  Breaking: the SQL text of every select changes, flat queries included (`SELECT "__t0"."id" FROM "users" AS "__t0"`). Results are unchanged. Anything asserting on generated SQL needs updating. `UPDATE` / `DELETE` / `INSERT ... RETURNING` and `$query` are byte-identical to before — nothing binds an alias outside a select tree.

  Docs: docs/internals/select-tree-aliasing.md, docs/internals/runtime-pipeline.md, docs/decisions/0003-select-tree-aliasing.md, docs/guide/relations.md

- 391bccc: Assemble every `WHERE` in one place, and let a column be marked read-only.

  **The where seam.** `OperationsFactory._validateWhereExpression` was a stub called only when the
  caller passed a filter, so a `findMany({})` never reached it, and it returned `where[0]` when
  given an array — silently dropping every other condition. It is now `_resolveWhere(table, where?)`
  and runs for every select (the root and every nested join level), every update and every delete,
  filter or no filter. That is what makes it usable as an injection point: a rule that only applied
  when the caller happened to filter would not be a rule.

  Several conditions are AND-ed, each wrapped so an `OR` among them keeps its precedence; a lone
  condition is returned untouched, so no existing query gains parentheses. **Breaking for direct
  `@dsqlbase/core` callers**: an array `where` now means "all of these" instead of "the first of
  these". No `dsqlbase` client path produces an array — the normalizer folds a `where` object into
  one node — so queries written against the client are unaffected.

  **Read-only columns.** `.readOnly()` marks a column system-managed:

  ```ts
  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().readOnly(),
    number: text("number").notNull(),
  });
  ```

  `workspaceId` is read like any other column — selectable, filterable, orderable, present on the
  row — but it is gone from `create`'s `data` and `update`'s `set`, in the types and at runtime.
  A `notNull` column with no default therefore stops being a _required_ input, which is the point:
  the value belongs to whatever manages the column, not to the caller. A field that arrives through
  an untyped spread is dropped by the normalizer rather than refused, so `create({ data: { ...input } })`
  keeps working; a direct `OperationsFactory` caller that passes one gets
  `Cannot write read-only column "…"`, beside the existing primary-key refusal.

  `toJSON` is unchanged, so the flag is invisible to migrations and introspection — it is a
  client-side rule, and a real database cannot report it.

  Docs: docs/internals/runtime-pipeline.md, docs/guide/schema.md, docs/guide/querying.md

### Patch Changes

- 635b282: Correct the `QueryArgs.limit` JSDoc: no default limit is applied when `limit` is omitted (the comment previously promised a default of 100 that the code never enforced).

  Docs: new root `docs/` set — `docs/README.md`, `docs/guide/*`, `docs/internals/*`, `docs/decisions/0001-docs-structure.md`, `docs/decisions/0002-migration-consolidation.md`; `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, and package READMEs now point at it.

- 6875231: Run the type-level test suite for real. `packages/dsqlbase` documented itself as running `vitest run --typecheck`, but no vitest config enabled `typecheck`, the package `test` script was plain `vitest run`, and the build `tsconfig.json` excludes `*.test.ts` — so every `expectTypeOf` assertion in `client.types.test.ts` was a no-op. `vitest.config.ts` now enables `test.typecheck` over `src/**/*.types.test.ts` against a new `tsconfig.test.json`, and a failed type assertion is reported as a failing test. The turbo `test` task also gains `dependsOn: ["^build"]`, so a package's workspace dependencies are built before its tests run instead of relying on a `dist/` left over from an earlier build. No runtime or published-API change.

  Docs: docs/internals/testing.md, CLAUDE.md

- 6875231: Attach models through one shared code path, keyed by schema alias.
  - `Table.alias` (`@dsqlbase/core`) carries the key a table is exported under, which may differ from the database table name (`members` vs. `team_members`). `SchemaRegistry` sets it; it defaults to the table name when a `Table` is constructed directly.
  - `SchemaRegistry.getTableEntries()` lists each table once, keyed by alias, and `getAlias(nameOrAlias)` resolves either name to the alias. `getTables()` is unchanged — it still keys every table under both its alias and its database name.
  - `attachModels(client, ctx)` in `packages/dsqlbase/src/client/database/base.ts` replaces the duplicated attachment loops in `createClient` and the transaction client, and records each model in `BaseClient._models`. A scoped client should now be built through it rather than by copying the loop.

  Behaviour change: models are attached once, under the alias only. A client over a schema with an aliased table previously also exposed a second model under the database table name (`dsql.team_members` alongside `dsql.members`) — that duplicate is gone. It was never part of the typed surface, since `Models<T>` is keyed off the schema object, so only code indexing the client dynamically could reach it.

  Docs: docs/internals/runtime-pipeline.md
  - @dsqlbase/core@0.2.0

## 0.1.6

### Patch Changes

- 830c371: fix time column type
  - @dsqlbase/core@0.1.6

## 0.1.5

### Patch Changes

- 4d93e48: Added transaction support
  - @dsqlbase/core@0.1.5

## 0.1.4

### Patch Changes

- 772d163: fix pg types
  - @dsqlbase/core@0.1.4

## 0.1.3

### Patch Changes

- f40df61: fix columns type exports
  - @dsqlbase/core@0.1.3

## 0.1.2

### Patch Changes

- 96b7e7d: package cleanup
- Updated dependencies [96b7e7d]
  - @dsqlbase/core@0.1.2

## 0.1.1

### Patch Changes

- 57c5e9e: connector session factories
- 4f4ecdd: internal packages restructure
  - @dsqlbase/core@0.1.1

## 0.1.0

### Minor Changes

- 66d5d93: **Query client and schema migration runner:**

  Added:
  - schema objects definition support for `namespace`, `table`, `domain`, and `sequence`;
  - schema migrations runner via introspection -> reconcile;
  - model client with crud operations factories for `create`, `findOne`, `findMany`, `update`, `delete`;
  - sql tag with filter expressions, `sql.in, sql.eq, ...`;

### Patch Changes

- @dsqlbase/client@0.1.0
- @dsqlbase/core@0.1.0
- @dsqlbase/schema@0.1.0
