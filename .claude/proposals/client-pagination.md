---
proposal: client-pagination
status: draft
owner: silviu
created: 2026-09-20
---

# Client pagination: keyset cursors with `paginate()` and `count()`

Prime: `.claude/prime/03-client.md` Topic 1. Review context: `.claude/prime/00-review.md`, `docs/internals/runtime-pipeline.md`, `docs/internals/codec-boundary.md`. Depends on `.claude/proposals/schema-prerequisites.md` stories 1 (`Table.primaryKey`) and 5 (`$$meta` + row-aware post-processors, amended here to receive the raw row).

## Problem

The client offers `limit` / `offset` only. A GraphQL API in front of it needs stable cursor pagination over arbitrary filters and orderings, and today every resolver hand-rolls the same thing: append the primary key to the order, build the `a < $1 OR (a = $1 AND id < $2)` predicate, fetch `limit + 1`, trim, encode a cursor, and run a separate `count(*)`. That code is duplicated per resolver, is easy to get subtly wrong (see "What the code does today"), and cannot be made tenant-safe centrally because it lives above the client.

### What the code does today (verified 2026-09-20)

- `QueryArgs` (`packages/dsqlbase/src/client/model/base.ts`) has `limit` / `offset`, an `orderBy` object whose key insertion order is the sort order, and no count, aggregate, or keyset helper. The former "default limit 100" JSDoc is already corrected; no limit is applied.
- The runtime `Table` (`packages/core/src/runtime/table.ts`) exposes no primary key — prerequisite story 1.
- `OperationsFactory._resolveSelectParams` (`packages/core/src/runtime/operation.ts`) receives `where` as an SQL node and hardwires `limit = 1` for `"one"` mode. It is the point where a keyset predicate can be AND-ed **after** `_validateWhereExpression`, the seam the tenancy topic will use for predicate injection, so both compose by construction.
- `SelectParams.select` is `SQLNode[]` (`packages/core/src/runtime/query.ts`), so hidden aliased expressions can be selected without touching `QueryBuilder`.
- `sql.*` (`packages/core/src/sql/tag.ts`) has no row-value or keyset builder.
- **Codec round-trips are lossy for timestamps.** `formatTimestamp` (`packages/dsqlbase/src/schema/utils/date.ts`) emits millisecond precision while `defaultNow()` stores `current_timestamp` at microsecond precision. A cursor rebuilt from the decoded `Date` of a row at `12:00:00.123456` becomes `.123`, and `created_at < $1 OR (created_at = $1 AND id < $2)` then skips every other row in that millisecond. The `codec-boundary.md` rule "round-trip cursor values through the codec" is therefore insufficient: **cursors must carry the database's own text representation of the order keys**, never a JS value.
- `Session.execute` (`packages/core/src/runtime/session.ts`) runs one statement; `ExecutableQuery` (`packages/core/src/runtime/executor.ts`) wraps one operation and is cloned per session by `$transaction` batching (`packages/dsqlbase/src/client/transaction/transaction-client.ts`).
- `ClientOptions` (`packages/dsqlbase/src/client/create.ts`) is `{ schema, session }`; `ExecutionContext` carries no options.
- The DSQL SQL-subsets index lists DDL pages only and is silent on row-value comparison (`(a, b) < ($1, $2)`); see "DSQL constraints".
- Side finding: the `findMany` JSDoc in `packages/dsqlbase/src/client/model/client.ts` shows `orderBy: [{ age: "desc" }]`, an array form the type rejects.

## Decisions taken during grilling

1. **Shape is ORM-neutral.** No Relay vocabulary (`first/last/edges/pageInfo`) in the client; a GraphQL layer maps to it in a few lines.
2. **Cursor is keyset-only**: wire text of the order keys (user keys + primary key) plus a signature of table alias + keys + directions. The caller re-supplies `where` / `select` / `join`. `where` is not part of the signature (changing filters mid-pagination is well-defined keyset behaviour). No HMAC: a cursor is equivalent to a `where` value the caller could pass, and tenancy predicates apply regardless.
3. **Per-row cursor lives at `$$meta.cursor`**, reusing the prerequisite story 5 mechanism.
4. **Page size**: `limit` optional; default from `createClient({ pagination: { defaultLimit } })` (100 when unset); `maxLimit` is optional and **enforced when present** (a larger `limit` throws).
5. **Order keys**: the total order is always `[...userOrderBy, ...primaryKey]`. Nullable order keys are refused at runtime in story A and supported in story B; no type-level restriction on `orderBy`.
6. **Both directions** (`after` / `before`).
7. **`count`**: opt-in second statement derived from the same normalized `where`; also exposed as `count({ where })`.

## Decision

Add `ModelClient.paginate(args)` and `ModelClient.count(args)`. `paginate` runs one `SELECT` with the keyset predicate AND-ed onto the user's (and any injected) `where`, an explicit `ORDER BY` over user keys plus the primary key, hidden `::text` projections of every order key, and `LIMIT limit + 1`; the resolver stamps `$$meta.cursor` on each row, trims the extra row into `hasNextPage` / `hasPreviousPage`, and reverses backward pages. With `count: true` a second statement, `SELECT count(*)` over the same `where` node, runs in parallel on the same session.

### Rejected options (one line each)

- **Opaque full-query token** (`nextToken` embedding `where` / `select` / `join` / `orderBy`) — unbounded size, the embedded `where` is forgeable without an HMAC secret, breaks on field renames between deploys, and cannot serialise function-valued join predicates (Topic 2). Trivially layered on top of this design by the app (`endCursor` is the token).
- **Keyset primitives only** (`after` on `findMany` + exported predicate builder; app builds pages) — moves the `limit + 1` / reversal / `hasNextPage` boilerplate back into every resolver, which is what the request wants removed.
- **Offset inside a cursor** — duplicates and skips under concurrent writes, `OFFSET n` reads and discards `n` rows on DSQL, forgeable, and still needs a tiebreaker. `offset` stays on `findMany`.
- **Relay-shaped result** — a consumer-library detail; the neutral shape below is the intersection of Prisma, MikroORM, Laravel, Ecto `Paginator` and Objection cursor APIs without naming any.
- **`count(*) OVER ()` in the page query** — counts rows *after* the cursor (the window sees the keyset predicate) and costs the full filtered scan on every page; cannot produce `totalCount`.
- **Type-level `notNull` restriction on paginate `orderBy`** — too limiting; nullable keys are handled in story B instead.

## API

```ts
const page = await dsql.tasks.paginate({
  where: { status: { in: ["todo", "in_progress"] } },
  orderBy: { dueDate: "asc", createdAt: "desc" },   // primary key appended automatically
  select: { id: true, title: true },
  join: { project: { select: { name: true } } },
  limit: 20,                                        // default: pagination.defaultLimit (100)
  after: args.after,                                // or before: args.before — never both
  count: true,                                      // opt-in second statement
});

page.items;                 // rows; each carries $$meta.cursor
page.hasNextPage;           // boolean
page.hasPreviousPage;       // boolean
page.startCursor;           // string | null (items[0].$$meta.cursor)
page.endCursor;             // string | null (items.at(-1).$$meta.cursor)
page.totalCount;            // number — present only when count: true

const n = await dsql.tasks.count({ where: { status: "done" } });   // number

const dsql = createClient({
  schema,
  session,
  pagination: { defaultLimit: 50, maxLimit: 200 },  // both optional; maxLimit enforced when set
});
```

Rules enforced at runtime (all throw before any SQL is built):

- `after` and `before` together; `limit <= 0`, non-integer, or `> maxLimit` when set.
- Table without a primary key (`Table.primaryKey` empty).
- Story A only: a nullable column in `orderBy` (`Column.notNull` false).
- A cursor whose version, encoding, or signature does not match the table alias + resolved keys (`InvalidCursorError`, exported from `dsqlbase`).
- A cursor containing `null` values in story A (the marker exists in the format from day one; A rejects it).

`distinct` and `offset` are absent from `PaginateArgs` at the type level.

### Cursor format

`c1.` + base64url(JSON `[signature, v0, v1, …]`) where `signature` is the first 8 hex chars of SHA-256 over `` `${table.alias}|${keys.map(k => `${k.field}:${k.direction}`).join(",")}` `` (keys include the appended primary key) and each `v` is the wire text of that key as returned by `column::text`, or JSON `null`. The prefix is the format version. Cursors are opaque to callers; the format is documented for debugging only and may change with the version prefix.

### Generated SQL

Forward, `orderBy: { createdAt: "desc" }`, `limit: 20`, `after` present (primary key `id`):

```sql
SELECT "tasks"."id", "tasks"."title", "__join_project"."data" AS "project",
       "tasks"."created_at"::text AS "__k0", "tasks"."id"::text AS "__k1"
FROM "tasks"
LEFT JOIN LATERAL (...) AS "__join_project" ON true
WHERE ("tasks"."status" IN ($1, $2))
  AND ("tasks"."created_at" < $3 OR ("tasks"."created_at" = $3 AND "tasks"."id" < $4))
ORDER BY "tasks"."created_at" DESC, "tasks"."id" DESC
LIMIT $5            -- limit + 1
```

Backward (`before`): every direction is flipped in SQL (`>` and `ASC`), `LIMIT limit + 1`, and the resolver reverses the rows. Mixed directions expand key by key: `k0 op0 $a OR (k0 = $a AND (k1 op1 $b OR (k1 = $b AND …)))`. No cursor: no keyset predicate, `ORDER BY` and hidden columns unchanged.

Count (`count: true` or `count()`):

```sql
SELECT count(*) AS "count" FROM "tasks" WHERE ("tasks"."status" IN ($1, $2))
```

Story B (nullable keys), `createdAt ASC NULLS LAST`, cursor value non-null:

```sql
"created_at" > $1 OR "created_at" IS NULL OR ("created_at" = $1 AND "id" > $2)
-- cursor value null:
"created_at" IS NULL AND "id" > $2
```

`ORDER BY` always emits the null placement explicitly (`ASC NULLS LAST`, `DESC NULLS FIRST` — Postgres defaults made explicit so cursor semantics do not depend on server defaults).

## Runtime design

Per layer of `docs/internals/runtime-pipeline.md`.

- **`packages/core/src/sql`** — new `keyset.ts` exporting `sql.keyset(keys: KeysetKey[], values: (string | null)[], bound: "after" | "before")` where `KeysetKey = { node: SQLNode; direction: "asc" | "desc"; nullable: boolean }`. Values are wrapped in bare `SQLParam`s (already wire text — no codec). Story A implements the non-null chain; story B adds the `IS NULL` branches driven by `nullable`.
- **Normalizer** (`packages/dsqlbase/src/client/model/normalizer.ts`) — `normalizePaginate(table, args)` builds a `SelectOperationArgs` from `select` / `where` / `join` via the existing helpers, then a `KeysetArgs = { keys: { field, column, direction }[], signature, take, direction: "forward" | "backward", cursor?: (string | null)[] }`: resolves `orderBy` fields, appends `Table.primaryKey` columns not already present (direction inherits the last user key, `asc` when there is none), applies `defaultLimit` / `maxLimit` from the context options, decodes and validates the cursor (`packages/dsqlbase/src/client/pagination/cursor.ts`: `encodeCursor`, `decodeCursor`, `keysetSignature`, `InvalidCursorError`), and performs the runtime refusals listed under API. `normalizeCount(table, args)` reuses `_getWhereExpression`.
- **Operations factory** (`packages/core/src/runtime/operation.ts`) — `PaginateOperationArgs extends SelectOperationArgs { keyset: KeysetArgs; count: boolean }`. `createPaginateOperation` calls `_resolveSelectParams` (so `_validateWhereExpression` — the injection seam — runs first), then: `where = and(where, sql.keyset(...))` when a cursor is present; `order` rendered from `keyset.keys` (flipped for backward) with explicit null placement; `select` extended with `sql\`${column}::text AS "__k<n>"\`` per key (through the same column wrapper prerequisite story 3 introduces, so aliasing applies); `limit = take + 1`. Its resolver runs before the generic `_createResultResolver`: reads `__k*` from each raw row, encodes `$$meta.cursor`, deletes `__k*`, trims the extra row into `hasNextPage` (forward) or `hasPreviousPage` (backward), sets the opposite flag to `cursor !== undefined`, reverses backward pages, fills `startCursor` / `endCursor`. `createCountOperation(table, { where })` builds `SELECT count(*) AS "count"` and resolves `Number(row.count)` (drivers return `bigint` as text).
- **Executor** (`packages/core/src/runtime/executor.ts`) — new `CompositeQuery<TResult>` (same `Thenable` base; `execute()` runs its operations with `Promise.all` on one session and combines; `clone(session)` so `$transaction([...])` batching keeps working). `paginate` returns an `ExecutableQuery` when `count` is false and a `CompositeQuery` when true; both satisfy the `Executable` interface `$transaction` accepts. On the pool session the two statements run on two connections (snapshots may differ by milliseconds — acceptable for a count); inside a transaction node-pg queues them on one client (same snapshot).
- **Context** (`packages/core/src/runtime/context.ts`) — `ExecutionContextOptions.options?: { pagination?: { defaultLimit?: number; maxLimit?: number } }`, stored as `ExecutionContext.options`; `createClient` forwards `ClientOptions.pagination`; the transaction client (and the shared `attachModels` from prerequisite story 2) forwards `options` to the derived context.
- **Query builder** (`packages/core/src/runtime/query.ts`) — no change.
- **Model client** (`packages/dsqlbase/src/client/model/client.ts`) — `paginate(args)`, `count(args)`; fix the `orderBy` JSDoc example.

Nested `join`s are untouched: only the root level is keyset-ordered; nested `has_many` lists are not paginated (a nested connection is a separate `paginate` on the child model with a `where` on the foreign key).

## Type design

`packages/dsqlbase/src/client/model/base.ts`:

```ts
export interface PaginateArgs<TTable extends AnyTable, TSchema extends AnySchema>
  extends Pick<QueryArgs<TTable, TSchema>, "select" | "where" | "orderBy" | "join"> {
  limit?: number;
  after?: string | null;
  before?: string | null;
  count?: boolean;
}

export type PageItemOf<TTable, TSchema, TArgs> =
  QueryResultOf<TTable, TSchema, TArgs> & { $$meta: { cursor: string } };   // merges with RecordMetaOf (prereq. story 5)

export type PageOf<TTable, TSchema, TArgs extends PaginateArgs<TTable, TSchema>> = Prettify<{
  items: PageItemOf<TTable, TSchema, TArgs>[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
} & (TArgs["count"] extends true ? { totalCount: number } : {})>;

export interface CountArgs<TTable extends AnyTable> { where?: WhereArgOf<TTable>; }   // object or callback, per client-runtime-joins.md
```

`ModelClient.paginate<TArgs extends PaginateArgs<TTable, this["__type"]>>(args): Executable<PageOf<TTable, this["__type"], TArgs>>`; `count(args?: CountArgs<TTable>): ExecutableQuery<number>`. `ClientOptions.pagination?: { defaultLimit?: number; maxLimit?: number }`. `after` / `before` are both optional at the type level (GraphQL arguments arrive as `string | null | undefined`); mutual exclusion is a runtime check. `PageOf` is reused by Topic 2's union client.

## DSQL constraints

- The keyset predicate uses the expanded `OR` / `AND` chain only, so nothing depends on row-value comparison support. **Verification item** for `docs/internals/dsql-capabilities.md`: does DSQL accept `(a, b) < ($1, $2)`? If yes, `sql.keyset` may switch to it for uniform-direction keys as a planner optimisation, behind the same builder.
- Cursor values are re-parsed by the server from `::text` output. `timestamptz` text includes the UTC offset, so `TimeZone` differences between sessions are harmless; a **different `DateStyle`** between the session that produced a cursor and the one consuming it could misparse dates. Document: cursors assume a stable `DateStyle` (Postgres default `ISO, MDY`). Verification item: whether DSQL allows changing `DateStyle` at all.
- Every page reads an index range on `(orderKeys…, primaryKey)` when such an index exists, otherwise a scan of the filtered set; the guide recommends an index matching the order keys. DSQL indexes have no `ASC | DESC` in their grammar; backward index scans cover `desc` orders.
- `count(*)` is a full scan of the filtered set on every call; hence opt-in.

## Failure modes

| Situation | Behaviour |
|---|---|
| Cursor from a different table, `orderBy`, or direction set | `InvalidCursorError` (signature mismatch) before SQL |
| Malformed / wrong-version cursor | `InvalidCursorError` |
| Well-formed forged cursor | Just a different keyset position; tenancy predicates (Topic 3) still apply; no privilege gained |
| `where` changed between pages | Well-defined: rows after the cursor position within the new filter |
| Order-key value of the cursor row mutated between pages | Standard keyset drift (a row may appear twice or be skipped); documented |
| Nullable order key (story A) | Error naming the column; story B lifts it |
| No primary key on the table | Error at `paginate` |
| `limit > maxLimit` | Error naming both numbers |
| `count: true` on the pool session | Two connections, snapshots may differ by milliseconds; inside `$transaction` same snapshot |
| Same-millisecond timestamps | Correct — cursors carry microsecond wire text (the reason for the hidden `::text` columns) |

## Interplay

- **Tenancy (`client-tenancy.md`)**: the keyset predicate is AND-ed after `_validateWhereExpression` (renamed `_resolveWhere` and made unconditional there), so injected predicates wrap both the page and the count statements; `createCountOperation` must call the same seam; a cursor is never a tenant boundary and must never be treated as one.
- **Runtime joins (`client-runtime-joins.md`)**: `join` accepts every entry form (declared, filtered, ad-hoc, `count`) and the `select` relation sugar; the root keyset is unaffected and nested lists are not paginated. `PaginateArgs.where` / `CountArgs.where` are `WhereArgOf<T>` (object or `(self) => object` callback); a callback where is an SQL node by the time the keyset predicate is AND-ed, so nothing changes here.
- **Polymorphic relations (`schema-polymorphic-relations.md`)**: the union client's `paginate` reuses `PageOf`, `sql.keyset`, and the cursor codec with keys = shared order columns + `$$key` + primary key, applied per branch as that proposal specifies; the hidden `__k<n>` projections are emitted per branch.
- **Global ids (`schema-guid.md`)**: cursors carry raw wire text, so a `guid` codec never sees them; `$$meta.cursor` sits beside `$$meta.globalId`.
- **Embeddable objects**: ordering by a group leaf column is an ordinary column; no special case.
- **Prerequisites** (`schema-prerequisites.md`): story 1 (`Table.primaryKey`) for the tiebreaker; story 5 (`$$meta`, post-processors) for `$$meta.cursor` — amended so post-processors receive the raw row; story 3 (aliasing) changes the hidden-column and predicate column references but not the design; story 7 (codec-aware where) is **not** required.

## Stories, ordering, changesets

Fixed version group (`@dsqlbase/core`, `dsqlbase`, `@dsqlbase/migration`). Both stories are additive; the epic release is `minor`.

### A. `paginate()` and `count()`

- **Change.** `sql.keyset` (non-null chain), `PaginateOperationArgs`, `createPaginateOperation`, `createCountOperation`, `CompositeQuery`, `ExecutionContext.options`, `ClientOptions.pagination`, cursor codec + `InvalidCursorError`, `normalizePaginate` / `normalizeCount`, `ModelClient.paginate` / `count`, `PaginateArgs` / `PageOf` / `CountArgs` types, runtime refusals including nullable keys, `orderBy` JSDoc fix.
- **Depends on.** `schema-prerequisites.md` stories 1 and 5.
- **Tests.** See test plan (A rows).
- **Docs.** `docs/guide/pagination.md` (new), `docs/guide/querying.md`, `docs/guide/transactions.md`, `docs/internals/runtime-pipeline.md`, `docs/internals/codec-boundary.md`, `docs/internals/dsql-capabilities.md`. Changeset: `minor` (`Docs: docs/guide/pagination.md, docs/guide/querying.md, docs/guide/transactions.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md, docs/internals/dsql-capabilities.md`).

### B. Nullable order keys

- **Change.** `sql.keyset` gains the `IS NULL` branches driven by `KeysetKey.nullable`; `ORDER BY` emits explicit `NULLS LAST` / `NULLS FIRST`; the normalizer drops the nullable refusal and marks keys from `Column.notNull`; the cursor codec accepts `null` values.
- **Depends on.** Story A.
- **Tests.** See test plan (B rows).
- **Docs.** `docs/guide/pagination.md` (remove the nullable restriction; document null placement). Changeset: `minor` (`Docs: docs/guide/pagination.md`).

### Breaking surface

None. New methods, new optional `ClientOptions.pagination`, new optional `ExecutionContextOptions.options`. Rows returned by `paginate` carry `$$meta.cursor` in addition to the story 5 `$$meta` fields.

## Test plan

Unit (`packages/core`, `packages/dsqlbase`):

- `sql/keyset.test.ts`: single asc, single desc, mixed directions, composite primary key, `after` vs `before` flipping, (B) nullable non-null value asc/desc, nullable null value, multiple nullable keys.
- `client/pagination/cursor.test.ts`: encode/decode round trip, version prefix, malformed base64url, malformed JSON, signature mismatch on alias / field / direction, (A) `null` value rejected, (B) accepted.
- `normalizer.test.ts`: primary key appended, not duplicated when listed, direction inheritance, default and max limit, `limit` validation, `after` + `before` refused, no primary key refused, (A) nullable key refused, `distinct` / `offset` not accepted (type test).
- `operation.test.ts`: SQL snapshot with hidden `__k*` columns and `LIMIT limit + 1`; resolver strips `__k*`, stamps `$$meta.cursor`, trims, sets flags, reverses backward; count operation SQL and `Number` conversion; the count statement's `where` is the same node instance as the page's.
- `executor.test.ts`: `CompositeQuery` runs both statements, combines, `clone(session)`.
- `client.types.test.ts`: `PageOf` item shape follows `select` / `join`; `totalCount` present only with `count: true`; `$$meta.cursor` on items, not on nested rows.

e2e (`packages/tests`, PGlite):

- Seed 25 `tasks` rows via `$query` with explicit microsecond timestamps, several sharing a millisecond; walk forward in pages of 10 by `createdAt desc` and assert the concatenation equals `findMany` with the same order, no duplicates, `hasNextPage` false on the last page; walk backward from the last `endCursor` and assert the reverse.
- Mixed-direction order, composite-key table (fixture added by prerequisite story 4), `join` on a paginated query, `where` change between pages, cursor reuse with a different `orderBy` throws, `count: true` equals `count()` equals `findMany().length`, `paginate` inside `$transaction` with and without `count`, `maxLimit` enforced.
- (B) Rows with `null` in the order key appear exactly once across a full forward and a full backward walk.

Failing tests that expose real bugs stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): new `pagination.md` (`paginate` / `count`, page shape, `$$meta.cursor`, cursor rules and opacity, `defaultLimit` / `maxLimit`, both directions, order-key rules and (A) nullable refusal / (B) null placement, `DateStyle` note, index advice, a short GraphQL mapping example without naming a client library); `querying.md` (replace "There is no `count`, aggregate, or keyset-pagination helper" with pointers; `createClient` options); `transactions.md` (`paginate` with `count` inside `$transaction`; batching accepts `CompositeQuery`).
- **Internals** (`docs/internals/`): `runtime-pipeline.md` (paginate and count operations; seam order — injected predicates, then keyset; `CompositeQuery`; `ExecutionContext.options`; remove "no count … no keyset helpers" from the query-args surface); `codec-boundary.md` (rewrite the cursor rule: cursors carry `::text` wire values and bypass codecs; why — µs precision); `dsql-capabilities.md` (verification items: row-value comparison, `DateStyle` settability).
- **Decision record**: `docs/decisions/0007-client-pagination.md` on acceptance (after `0003`–`0006` from the schema topics); this proposal is then deleted.
- **Stale lines**: `findMany` JSDoc `orderBy` array example in `packages/dsqlbase/src/client/model/client.ts`; `docs/guide/querying.md` "no count / keyset helper" sentence; none in `CLAUDE.md`. `packages/dsqlbase/README.md` gains a `paginate` example.
- **Cross-topic notes to carry forward**: the tenancy topic must inject predicates before the keyset AND (already the case at `_resolveSelectParams`) and on `count`; the runtime-joins topic leaves the root order untouched and switches `where` to `WhereArgOf`; the polymorphic-relations proposal reuses `PageOf`, `sql.keyset`, and the cursor codec.
