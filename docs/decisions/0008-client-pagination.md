# 0008 — Keyset pagination

- **Date:** 2026-09-27
- **Status:** accepted
- **Proposal:** `client-pagination.md` (local working artifact, not tracked)

## Context

The client offered `limit` / `offset` only. A GraphQL API in front of it needs stable cursor pagination over arbitrary filters and orders, and every resolver was hand-rolling the same code: append the primary key to the order, build `a < $1 OR (a = $1 AND id < $2)`, fetch one extra row, trim it, encode a cursor, run a separate `count(*)`. That code is easy to get subtly wrong — a cursor rebuilt from a decoded `Date` loses the microseconds a `timestamptz` compares on and skips rows — and, living above the client, it cannot be made tenant-safe centrally.

## Decision

- **`ModelClient.paginate(args)` and `count(args?)`.** A page is `{ items, hasNextPage, hasPreviousPage, startCursor, endCursor }`, plus `totalCount` when `count: true`, with each item's own cursor at `$$meta.cursor`. The shape is ORM-neutral: no Relay vocabulary in the client, which a GraphQL layer maps in a few lines.
- **A total order, always.** The caller's `orderBy`, then every primary-key column not already named, in the direction of the last key (`asc` without one). A table without a primary key is refused.
- **A cursor is keyset-only**: `c1.` + base64url of `[signature, ...values]`. Each value is the order key's **database text** (`col::text`, projected as a hidden `__k<n>` column and read off the raw row), bound back as a bare parameter — no codec sees it in either direction. The signature is 8 hex characters of SHA-256 over the table alias and the ordered `field:direction` keys. `where`, `select` and `join` are not part of it: the caller supplies them on every page, and changing `where` mid-walk is well-defined. There is no HMAC: a forged cursor is only another position, equivalent to a `where` the caller could write, and the tenant predicate applies regardless.
- **Both directions.** `before` reads every direction flipped and reverses the page back into order. Only the flag in the direction of travel is exact; the other says whether a cursor was passed.
- **The keyset predicate is expanded key by key**, `k0 > $a OR (k0 = $a AND (k1 > $b OR …))`, so mixed directions and nullable keys need no special case and nothing relies on DSQL supporting row-value comparison.
- **Nullable keys** sort their nulls where Postgres does by default — last ascending, first descending — written explicitly into the `ORDER BY` (`ASC NULLS LAST` / `DESC NULLS FIRST`) so the order never depends on a server setting. Flipping a direction flips the placement with it. The keyset gains `IS NULL` / `IS NOT NULL` branches, and a cursor carries `null` for such a key. `notNull` keys get no placement clause: they have no nulls to place.
- **The keyset joins the seam, it does not bypass it.** The normalizer passes `where: [callerWhere, keyset]`, so `_resolveWhere` renders tenant predicate, then the caller's filter, then the keyset.
- **`count` is opt-in** on a page: a second statement over the caller's filter alone — the very node the page filters by, without the keyset — so the total does not shrink as pages advance. It is also `count({ where })` on its own.
- **Page size**: `limit`, else `createClient({ pagination: { defaultLimit } })`, else 100; `maxLimit`, when set, refuses a larger `limit`.
- **The client owns page shaping; core provides general-purpose pieces** — the split global ids settled in [0007](./0007-global-ids.md). Core gained `sql.keyset`, `SelectOperationArgs.keys` (the hidden root-level projections), `createCountOperation`, and `Executable` / `CompositeQuery`. The cursor format, the page shape and `InvalidCursorError` live in `dsqlbase`, and `paginate` stamps cursors by wrapping the select operation's `resolve` rather than through a `MetaResolver`, which would have put the cursor codec and the order's signature in core.
- **`$transaction([...])` takes any `Executable`**, so a counted page — two statements as a `CompositeQuery` — batches like a single query.

### Rejected

- **An opaque full-query token** embedding `where` / `select` / `join` / `orderBy` — unbounded size, a forgeable embedded `where` without an HMAC secret, broken by field renames between deploys, and unable to carry function-valued predicates. An application can still layer one on top: `endCursor` is the token's core.
- **Keyset primitives only** (`after` on `findMany` plus an exported predicate builder) — moves the `limit + 1`, reversal and flag boilerplate back into every resolver, which is what the request wanted removed.
- **Offset inside a cursor** — duplicates and skips under concurrent writes, reads and discards `n` rows per page, is forgeable, and still needs a tiebreaker. `offset` stays on `findMany`.
- **A Relay-shaped result** — a consumer-library detail.
- **`count(*) OVER ()` in the page query** — the window sees the keyset predicate, so it counts rows after the cursor rather than the total, and costs the full filtered scan on every page anyway.
- **Refusing nullable order keys at the type level** — too limiting; supported at runtime instead.
- **A `MetaResolver` for `$$meta.cursor`** — what [0004](./0004-record-meta.md) anticipated. It receives the raw row, which is all it would need, but building the cursor there puts a client concern in core; wrapping `resolve` in the client reads the same raw rows.

## Consequences

- **Two methods on every model**, and `ClientOptions.pagination`. `InvalidCursorError` is exported from `dsqlbase` with a `code` (`format`, `version`, `mismatch`).
- **`$transaction`'s array overload is typed over `Executable<unknown>[]`** rather than `ExecutableQuery<unknown>[]` — it only widens what is accepted.
- **Cursors assume a stable `DateStyle`** between the session that produced one and the session consuming it, since their values are re-parsed from text. Whether DSQL lets a session change it is listed for verification.
- **A counted page on a pool may read two snapshots** a moment apart, one per connection; inside a transaction both statements share one.
- **Only the root level is paged.** A nested `hasMany` list is not; a nested connection is a separate `paginate` on the child model filtered by its foreign key.
- **The tenancy isolation specs now cover `paginate` and `count`**, including cursors taken on an unscoped client and from another workspace's own row — the exit criterion [0006](./0006-client-tenancy.md) set.
- **Two bugs fixed on the way**, each in its own commit: an empty `where: {}` rendered a bare `WHERE ` (reads now treat it as no filter; `findOne` / `update` / `delete` refuse it), and the e2e fixture's composite-key table was never registered because `table().primaryKey()` returns the constraint, not the table.
- Changeset level `minor`, two changesets — one per story — plus a `patch` for the empty-`where` fix.

## Docs

- [Pagination (guide)](../guide/pagination.md) — the whole feature from a consumer's side.
- [Querying (guide)](../guide/querying.md) and [Transactions (guide)](../guide/transactions.md) — the new methods and batching.
- [Runtime pipeline](../internals/runtime-pipeline.md) — core pieces vs client page shaping, and the seam order.
- [Codec boundary](../internals/codec-boundary.md) — why cursors bypass codecs.
- [DSQL capabilities](../internals/dsql-capabilities.md) — row-value comparison and `DateStyle`, to verify.
