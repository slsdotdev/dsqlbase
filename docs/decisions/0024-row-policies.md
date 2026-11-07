# 0024 — Row policies, enforced by the runtime

- **Date:** 2026-11-07
- **Status:** accepted
- **Supersedes:** [0005](./0005-tenant-client-visibility.md) (tenant table visibility on the
  client) and [0006](./0006-client-tenancy.md) (application-level tenancy)
- **Proposal:** `row-policies.md` (local working artifact, not tracked)

## Context

`tenantScope` bounded rows by equality on claim columns, and nothing else: no owner-only writes,
no "members read, authors edit", no composition. It was brittle where it was not limited — a
type-level visibility map (`VisibleFor`), a claim-type registry check, an enforcement flag, an
identity client with its own error. Finer rules needed a different model, and the one people
already know is PostgreSQL's row-level security.

DSQL offers none of it. Probed live: `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` are refused,
`SET ROLE` is refused, and custom settings exist only session-wide, outside a transaction, with
the value inlined — so the `set_config` + `current_setting()` route native-RLS applications use
(Drizzle, PostgREST/Supabase) is closed, and on a pooled connection a session-wide value is the
cross-request leak those projects warn about. Even where it is open it costs a transaction per
request (~112 ms against ~39 ms for a lone statement, measured).

## Decision

- **Policies shaped like `CREATE POLICY`**: `table.policy(name, (t) => ({ as, for, using, check }))`,
  with RLS semantics — permissive OR-ed, restrictive AND-ed, default deny once a table has any,
  update / delete also bounded by select policies, `using` filters silently, `check` throws,
  `check` defaults to `using`. Close enough that the same definitions can become DDL if DSQL ships
  RLS.
- **Enforced by `core` while it builds each statement.** The read predicate leads the `WHERE`
  seam every level passes through (root, joins, union branches, counts, pages, node lookups). The
  write check is one `RETURNING` expression whose failure casts a marker to `int`: one statement,
  atomic, no extra round trip. Alternatives rejected on the probe: a guarded
  `INSERT … SELECT … WHERE NOT EXISTS` cannot see `DEFAULT`ed columns (`DEFAULT` is illegal there)
  and cannot tell a violation from nothing matched; a transaction per write costs ~3×.
- **The check's marker is row-dependent** (`|| coalesce(left(<key>::text, 0), '')`): a check over
  parameters alone is otherwise folded at plan time and fails an update that matched nothing.
  It is empty, so the error never carries row data, and never `NULL`, so a violation cannot pass.
- **Settings**, not identity: `settings({ ... })` declares typed per-request values with column
  builders; `dsql.$settings(values)` derives a client carrying them, as ZenStack's `enhance` and
  Prisma's per-request extensions do. They render as bound parameters. A shared client with
  `$set` / `$reset` was rejected: concurrent requests interleave between `await`s.
- **An unset setting is `NULL`, and the policy decides** — the behaviour of
  `current_setting(key, true)`. Nothing checks a missing setting anywhere else: not at build
  time, not in `createClient`, not in `$settings`.
- **`$onCreate(() => setting)`** fills a column from a setting at runtime, so migrations see no
  `DEFAULT`; with `.readOnly()` it replaces the claim-column fill.
- **Errors**: `ExecutableQuery` decodes the marker into `PolicyViolationError(table, command, as,
policies)` with the driver error as `cause` — in core, so a consumer-written session gets it.
  The transaction runner rolls back and rethrows; it is not an OCC retry.
- **`createClient({ policies: { bypass: true } })`**, per client, never per call — the
  `BYPASSRLS` analogue.
- **Tenancy is removed entirely**: `tenantScope`, `tenantKey`, `TenancyError`, `identity` /
  `tenancy` on the context, `$identityClaims`, `VisibleFor`, the claim-type check. No
  compatibility layer — two rule languages would be worse than a clean cut.

## Consequences

- **Breaking (`minor`, pre-1.0)**: every tenancy API is gone; a schema migrates to a read-only
  `$onCreate(() => params.x)` column and a policy over it.
- Every table is on every client. A client cannot see at compile time what it may read; an empty
  result is the runtime answer, as in RLS.
- A missing setting is an empty result or a refused write, not an early error naming it. A policy
  that turns `NULL` into true opens rows; the guide says to compare settings with `=`.
- **Not expressible yet**: roles (`TO`) — DSQL fixes the role per connection, and an emulation
  would filter policies when a statement is built; a subquery on another table does not apply
  that table's policies, and one on the same table renders under the outer alias (a structured
  `exists()` helper would fix both); raw SQL is never policed; the computed-discriminator probe
  reads union members without their policies, revealing which member holds a key.

## Docs

- [Row policies (guide)](../guide/policies.md)
- [Runtime pipeline → Row policies, Settings](../internals/runtime-pipeline.md#row-policies)
- [Codec boundary](../internals/codec-boundary.md)
- [DSQL capabilities → Other](../internals/dsql-capabilities.md#other)
- [Architecture](../internals/architecture.md)
