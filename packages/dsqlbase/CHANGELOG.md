# dsqlbase

## 0.2.0

### Minor Changes

- 2e0b361: Types and the model surface:
  - **Relations split across several `relations()` blocks are typed;** a table with two blocks had no relation names at the type level, though its queries ran.
  - **One model per table, under its schema alias.** A table exported as `members` but named `team_members` also appeared as `dsql.team_members` when the client was indexed dynamically; that duplicate is gone. `Table.alias` holds the alias.
  - **Exported object types are `type` aliases,** so they can no longer be extended by declaration merging (`declare module "dsqlbase" { interface QueryArgs … }`).

  **Breaking:** the two behaviour changes above.

  Docs: docs/guide/relations.md, docs/internals/runtime-pipeline.md

- 2e0b361: Column writes:
  - **`$onUpdate` runs on every update,** not only when the update also names its column, so `updatedAt.$onUpdate(() => new Date())` works on its own. A value the update sets still wins, and the hook's value is validated and encoded like any written value.
  - **`numeric()` / `decimal()` take `{ precision, scale }`** and default to `numeric(18,6)` — what DSQL makes of a bare `numeric` — so Postgres and PGlite store the same type and DSQL no longer re-plans it. A value the column would round or overflow throws `ColumnValidationError` instead of being rounded silently.
  - `identity(name, { sequenceName })` keeps the sequence name it is given.

  **Breaking:** an update writes every column with an `$onUpdate` hook; a bare `numeric()` is `numeric(18,6)` on Postgres and PGlite; writes that would round a `numeric` now throw.

  Docs: docs/guide/schema.md, docs/guide/dsql-notes.md

- 2e0b361: Embedded objects: `embedded({ amount, currency })` declares a reusable value object, and `.column("net_value")` places it in a table as a column group — one column per member (`net_value_amount`, …), each with its own type, codec, validator and `.notNull()`. Groups nest and take `.default(obj)`.
  - **Reading:** a group reads as a nested object; `select` takes it as `true` or a map of its members. A group whose members are all nullable reads `null` when every column is `NULL`.
  - **Writing:** `create` writes the members given, `update` only the members given, and `null` clears an all-nullable group.
  - **Filtering and ordering:** a group takes `exists` and a nested `where` over its members; `orderBy` and `paginate` take a nested order per group.
  - Constraint and index callbacks reach members as `c.netValue.amount`. Migrations see plain columns.

  **Breaking,** for `@dsqlbase/core` callers: `Table.getColumn` returns a `Column` or a `ColumnGroup`, and table column maps accept groups.

  Docs: docs/guide/embeddable-objects.md, docs/guide/schema.md, docs/guide/querying.md, docs/decisions/0013-embeddable-objects.md

- 2e0b361: Filters follow the column's type. Every column carries a runtime type — `string`, `uuid`, `number`, `bigint`, `boolean`, `date`, `interval`, `bytes`, `json`, `jsonb`, `array`, `object` — which decides the `where` operators it takes, whether a bare value means `eq`, and whether it can be an `orderBy` key. The types and the runtime follow the same table, so a refused operator also throws when the query is built, before any SQL runs.
  - Several operators on one field all apply: `{ pages: { gte: 1, lte: 5 } }` used to keep only the first.
  - Filter values go through the column's codec, as inserts and updates do, so a `Date`, a `bigint` or a `Duration` filters the way it is stored.
  - `%` and `_` in `beginsWith`, `endsWith` and a string `contains` match themselves, not any text.
  - `in: []` matches no row and `notIn: []` every row; both used to fail as SQL.
  - An empty `where: {}`, an empty `and` / `or`, and an `or` with a `{}` branch filter nothing. `findOne`, `update` and `delete` refuse an empty `where`.

  **Breaking:**
  - `bytea` and `json` columns filter by `exists` only, and neither they nor `jsonb` columns can be ordered by; pattern operators are refused on non-string columns, and comparisons on `boolean`. These all built SQL Postgres rejects.
  - An unknown operator throws, including an object naming only unknown ones (`{ assigneeId: { isNull: true } }`), which used to be compared as a value. A direction other than `"asc"` / `"desc"` in `orderBy` throws.
  - A `%` or `_` in a pattern operator's value no longer acts as a wildcard.
  - `@dsqlbase/core`: `ColumnConfig` and `DomainConfig` gain a `runtimeType` parameter. A custom `Session` now receives filter values encoded by the column's codec.

  Docs: docs/guide/querying.md, docs/internals/codec-boundary.md

- 4433815: Global ids: an id that names its table as well as its row.
  - **`guid(name, key?)`** (from `dsqlbase/schema`) is a `uuid` column whose values read back as `guid:<base64url>`. A table whose primary key is exactly one `guid()` column is a **node**, keyed by its schema alias. The second argument names the node a column points at — `guid("author_id", "authors")` makes `article.authorId` and `article.author.id` the same string. It serializes exactly as `uuid()`, so adopting it on an existing column changes no DDL.
  - **Wrapped ids and raw uuids are both accepted** wherever the column is. An id naming another node throws `GlobalIdError("key_mismatch")` when the query is built.
  - **`dsql.$findByGlobalId({ id, on? })`** reads the row an id names, or `null`. **`dsql.$listByGlobalId({ ids, on? })`** reads many — one query per table — in the order given, with `null` for a miss. Both go through the table's model client, so they carry the tenant predicate. Their rows carry a top-level `$$key` naming the node, which narrows the result type.
  - `encodeGlobalId`, `decodeGlobalId`, `isGlobalId` and `GlobalIdError` are exported from the package root.

  **Breaking:** `$$meta.key` is typed as the literal schema alias rather than `string`. Three schemas that used to build now throw when the client is created: two tables claiming one node key, a `guid()` column naming no node, and a relation whose two sides disagree about global ids.

  Docs: docs/guide/global-ids.md, docs/guide/schema.md, docs/guide/relations.md, docs/decisions/0007-global-ids.md

- 2e0b361: JSON columns: `jsonb()`, `array()` and `record()`, validated by any Standard Schema.
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

- 2e0b361: Rename and retire columns and tables without losing data.
  - **`.renamedFrom("previous")`** on a column or a table makes the migration emit `RENAME` instead of a drop and an add. Constraints and indexes named after the old name are renamed with it. When both names exist, the rename is refused (`RENAME_CONFLICT`); once the database has the new name, the hint does nothing.
  - **`.deprecated()`** on a column hides it from the client — results, filters, ordering and inputs, in the types and at runtime — and marks it in the database with the comment `dsqlbase:deprecated`, dropping its `NOT NULL` when it has no default. A table created with a column already deprecated gets the marker in the same run.
  - **In a later release,** removing the column from the definition drops it as a **lossy** step, so it runs without `allow.destructive`.

  A primary-key column or an embedded-object member can't be deprecated.

  Docs: docs/guide/schema.md, docs/guide/migrations.md

- 2e0b361: Keyset pagination: `paginate()` and `count()` on every model.
  - **`dsql.<model>.paginate({ select, where, orderBy, join, limit, after | before, count })`** reads one page under a total order — your `orderBy`, then every primary-key column you didn't name. It returns `{ items, hasNextPage, hasPreviousPage, startCursor, endCursor }`, each item's cursor at `$$meta.cursor`, and `totalCount` with `count: true`. A page read `before` a cursor comes back in forward order.
  - **Order keys may be nullable.** Nulls sort where Postgres puts them by default — last ascending, first descending — and the `ORDER BY` states it, so pages don't depend on a server setting.
  - **Cursors** carry each key as the database's own text, so microsecond timestamps and big integers page exactly. A cursor is valid only under the order it was taken with; anything else throws `InvalidCursorError` before any SQL runs.
  - **`dsql.<model>.count({ where? })`** resolves to a number. Pages and counts go through the tenant predicate, so a cursor is never a way across tenants.
  - **`createClient({ pagination: { defaultLimit, maxLimit } })`** — `defaultLimit` is 100; `maxLimit`, when set, refuses a larger `limit`. A `findMany` without `limit` still returns every row.
  - **`$transaction([...])` accepts a counted page** (two statements) like any query. In `@dsqlbase/core`: `sql.keyset`, `Executable` and `CompositeQuery`.

  Docs: docs/guide/pagination.md, docs/guide/querying.md, docs/decisions/0008-client-pagination.md

- 2e0b361: Polymorphic relations: `union()` of tables, relations to it, and reading it directly.
  - **`union({ photos, videos })`** (from `dsqlbase/schema`) declares tables that can stand in for one another. `union.columns` holds their shared fields — those every member declares with the same type. A union produces no DDL.
  - **Relations to a union.** `hasMany`, `hasOne` and `belongsTo` accept one. A join to it takes shared-field `select`, `where`, `orderBy`, `limit` and `offset`, applied to every member, plus a per-member `on: { alias: true | false | { select, where, join } }` — GraphQL's fragments. It runs as one `UNION ALL`, ordered and limited across all members in SQL.
  - **`$$key`** on every union row names its member and narrows the result type. In a `where` it filters by member (`{ $$key: { in: types } }`), decided while the query is built, so a member that can't match adds no SQL; `orderBy: { $$key: "asc" }` sorts by it.
  - **`belongsTo(union, { from, to, discriminator })`** joins the member the row's discriminator names. Its `from` column is a keyless `guid()`, which reads, writes and filters global ids keyed by that discriminator.
  - **`dsql.<unionAlias>`** reads a union directly: `findOne`, `findMany`, `paginate` (cursors over `orderBy`, `$$key` and the primary key) and `count`. It is read-only; rows are written through their member's model.
  - Every member passes the tenant predicate in its own branch. A union is on a client only when every member is.
  - Relations to a union are validated when the client is created: members, column pairs, `to` lists, discriminators and global-id agreement.

  **Breaking,** for `@dsqlbase/core` callers: a relation's `target` may be a union (`SchemaRegistry.getRelationTarget` returns `AnyTable | Union`), and `JoinParams` is `TableJoinParams | UnionJoinParams`. In `dsqlbase`, the `on` map of `$findByGlobalId` and `$listByGlobalId` takes `{ select, where, join }`.

  Docs: docs/guide/polymorphic-relations.md, docs/guide/relations.md, docs/guide/querying.md, docs/decisions/0009-polymorphic-relations.md

- 2e0b361: Query fixes:
  - **Self-relations and same-named tables in different schemas join correctly.** Every level of a select now has its own alias (`FROM "tasks" AS "__t0"`); before, a `tasks.parent → tasks` join matched each row against itself.
  - **`bigint` values stay exact in joined rows and union rows,** which reach the client as JSON: `9007199254740993n` came back as `9007199254740992n`.
  - **`$listByGlobalId` finds an id whose uuid is spelled differently** (upper case, braces, no hyphens), as `$findByGlobalId` does.
  - **`$execute` refuses a `sql` template,** which it ran as nothing; pass one to `$query`, or call `.toQuery()`.

  **Breaking:** the SQL text of every select changes (results don't), so tests asserting on generated SQL need updating. `@dsqlbase/core/sql/expressions`, an undocumented module duplicating the `sql` helpers, is removed: use `sql.eq`, `sql.and` and the rest.

  **Known issue:** `update` and `delete` change every row their `where` matches but return only one of them. A fix is planned for the next release; until then, filter them by a unique key. See docs/guide/querying.md.

  Docs: docs/guide/querying.md, docs/guide/global-ids.md, docs/internals/select-tree-aliasing.md, docs/internals/codec-boundary.md, docs/decisions/0003-select-tree-aliasing.md

- 0927824: `$$meta` on every row, and `table().meta()` to put your own data in it.

  Every result row — from `findOne` / `findMany`, each joined level, and the rows `create` / `update` / `delete` return — carries `$$meta: { key, table, schema? }`: `key` is the schema alias (`members`), `table` the database name (`team_members`). `table("tasks", { … }).meta({ __typename: "Task" })` adds your own fields to it, typed. It is the first key of the row and survives `{ ...row }` and `JSON.stringify`.

  **Breaking:** rows gain a property, so a whole-row `toEqual` needs `$$meta`. `$$meta` and `$$key` are reserved field names.

  Docs: docs/guide/querying.md, docs/guide/schema.md, docs/decisions/0004-record-meta.md

- 6b80bf1: Relations in `select`: `select: { id: true, author: { name: true } }` reads exactly as `join: { author: { select: { name: true } } }` — same SQL, same result type. A relation takes `true` or a field map over its target, which may name the target's own relations. Filters, order and limits on a relation stay in `join`, and naming one relation in both throws.

  No `select`, or one naming nothing as `true`, returns every column; naming columns returns those; naming only relations returns only the relations.

  **Breaking:**
  - The result type of `select: {}` (or an all-`false` select) is the full row, as the runtime already returned. A `join` key set to `false` is no longer in the result type.
  - `@dsqlbase/core`: `SelectOperationArgs.select` is optional, and `[]` now means no column rather than every column.

  Docs: docs/guide/querying.md, docs/guide/relations.md, docs/decisions/0010-relation-select.md

- 2e0b361: A schema that would build wrong queries or DDL now fails when it is declared or when the client is created, naming the problem:
  - More than one primary key on a table (`MULTIPLE_PRIMARY_KEYS` in migration validation). A composite key is one constraint over several columns.
  - Two fields mapped to one database column (`DUPLICATE_COLUMN_NAME`).
  - A relation named like a column of its table: columns and relations share one field namespace.
  - A relation whose column pairs differ in number or type, or name a column of the wrong table.
  - An identity's explicit sequence name already used in its namespace (`DUPLICATE_SEQUENCE_NAME`).

  `Table.primaryKey` and `Table.isCompositeKey` expose the key at runtime, wherever it was declared.

  **Fixed:** `PrimaryKeyConstraintDefinition.include()` replaced the key columns with the included ones.

  **Breaking:** each schema above used to build and failed later, or silently misbehaved.

  Docs: docs/guide/schema.md, docs/guide/relations.md, docs/internals/migration-pipeline.md

- 2e0b361: Tenancy: declare a tenant boundary in the schema, and let the client enforce it. Aurora DSQL has no row-level security, so the client is the last place a multi-tenant application can be stopped from crossing tenants.
  - **Declaring it.** `tenantScope(claims)` (from `dsqlbase/schema`) defines the claim columns every table in a boundary carries: `ws.table(name, columns)` merges them in, and `ws.columns()` spreads into any other table, a namespaced one included. Claim columns must be `notNull`; they are ordinary columns in the DDL.
  - **Scoping a client.** `dsql.$identityClaims(claims)` derives a client for one request. Every read it builds carries the claim predicate ahead of your own `where`, at the root and at every joined level; every update and delete carries it too, and `create` fills the claim columns. A scoped client has no `$query`, `$execute` or `$identityClaims`, since raw SQL would bypass the predicate. `$transaction` inherits the scope.
  - **Enforcing it.** By default a client without claims cannot reach a tenant table: it is absent from the client's type and throws `TenancyError` when a query is built, including through a join. `createClient({ tenancy: { enforce: false } })` lets an internal process run unscoped.
  - **`.readOnly()`** marks a column as managed by something other than the caller. It reads like any column, but it is left out of `create`'s `data` and `update`'s `set`, in the types and at runtime. Claim columns are read-only.

  **Breaking:**
  - Adopting `tenantScope` takes those tables away from a default client until it is scoped — the point of `enforce: true`.
  - A schema that gives one claim name two data types, or a claim column that is not `notNull`, now throws when the client is created.
  - For direct `@dsqlbase/core` callers: an array `where` passed to `OperationsFactory` means all of its conditions (it used to keep only the first). Client queries never produce one.

  Docs: docs/guide/tenancy.md, docs/guide/schema.md, docs/guide/querying.md, docs/decisions/0005-tenant-client-visibility.md, docs/decisions/0006-client-tenancy.md

### Patch Changes

- 2e0b361: Documentation now lives in [`docs/`](https://github.com/slsdotdev/dsqlbase/tree/main/docs): a guide for using the packages, the internals for contributing, and a record of each design decision. The package READMEs point there, and `QueryArgs.limit` no longer claims a default limit that was never applied.

  Docs: docs/README.md, docs/guide/README.md, docs/internals/README.md, docs/decisions/README.md

- 2e0b361: Packaging fixes for every published package:
  - **The MIT `LICENSE` is now in each tarball.** It was listed as `../../LICENSE`, a path npm ignores, so no release shipped it.
  - **`engines.node` is declared, `>=22`**, and CI runs every suite on Node 22 as well as 24.
  - **In `exports`, `types` comes before `default`**, as TypeScript expects. It resolved before only because the `.d.ts` files sit next to the `.js` files. `publint` and `attw` now check every package in CI.
  - **`homepage` points to the repository.**
  - **Sourcemaps include their sources**, so stack traces and debuggers show the original TypeScript. This makes the packages larger.
  - **The build starts from an empty `dist/`**, so a deleted module can't linger in a tarball.

  Docs: docs/guide/install.md (Requirements), docs/internals/conventions.md (Packaging), docs/internals/architecture.md.

- 2e0b361: The `pg` session returns every transaction's connection to the pool exactly once. A failed `BEGIN`, `COMMIT` or `ROLLBACK` used to keep the connection checked out, so the pool ran dry one failure at a time. A broken connection is now destroyed rather than reused, and `rollback()` doesn't throw. `$transaction` always throws the error that caused the rollback, so a `40001` is still retried when the rollback fails too. The PGlite session waits for `BEGIN`. `TransactionSession` documents this contract for custom sessions.

  Docs: docs/guide/sessions.md, docs/guide/transactions.md

- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [0927824]
- Updated dependencies [6b80bf1]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
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
