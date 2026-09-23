# 0006 — Application-level tenancy

- **Date:** 2026-09-23
- **Status:** accepted
- **Proposal:** `client-tenancy.md` (local working artifact, not tracked)

## Context

A tenant application carries an owning column on most of its tables and has to filter every read by it and set it on every write. Doing that at the call site works until it is forgotten once, and that failure is silent in both directions: a read returns another tenant's rows, a write lands in no tenant.

Aurora DSQL provides nothing underneath to catch it — no row-level security, permissions are schema-level grants ([DSQL capabilities](../internals/dsql-capabilities.md)) — so if the boundary is not in the ORM it is nowhere. That makes it a correctness feature rather than a convenience, which is the reason it is applied below the point where queries are written rather than offered as something to call.

## Decision

- **A tenant boundary is declared once, as a set of claim columns.** `tenantScope(claims)` produces the columns every table in the boundary carries; `ws.table()` is sugar and `ws.columns()` spreads into any other constructor. It is the only producer of the `tenantKey` marker, because a per-column marker would leave nothing that says "these are the claims" for an identity to be matched against.
- **Claim columns are system-managed.** They reuse the `readOnly` marker from the `WHERE`-seam work: readable, selectable, filterable and orderable, never part of `create`'s `data` or `update`'s `set`. A value arriving through an untyped spread is dropped rather than refused, so `create({ data: { ...input } })` keeps working and the claim always wins.
- **Identity lives on `ExecutionContext`, not in a hook.** `$identityClaims(claims)` derives a client with a new context, the same mechanism a transaction client uses. Nothing is resolved per call and there is no ambient state, so a query's SQL is fixed by whichever client built it — which is why batching a scoped query into an unscoped transaction stays scoped.
- **One seam applies it.** `_resolveWhere` gained `_tenantPredicate`, so the boundary reaches root selects, every nested join level, updates and deletes through the one path they already shared. `_resolveInsertEntries` fills claim columns from the identity ahead of the `onCreate`/`DEFAULT` fallback.
- **Refusal at build time, not execution.** A tenant table reached with no claims throws `TenancyError` when the operation is built. This is what covers a nested join, where no type can help: a level is named by a relation, not by the client.
- **Enforcement is per client and defaults on.** `createClient({ tenancy: { enforce: false } })` is for a process that is meant to run unscoped. Inserting still requires claims in both modes, since nothing else can fill a `notNull` column.
- **Equality on claim columns only.** Role-dependent row rules are application authorization and stay there.
- **The client's type says what it can address** — recorded separately in [0005](./0005-tenant-client-visibility.md), which is provisional.

## Rejected alternatives

- **Schema per tenant with DSQL grants** — the only database-enforced boundary, but one schema per tenant does not fit the tenant count, every migration multiplies, and cross-tenant reporting becomes impossible.
- **Generic query policies** (`policy(table, { using, check })`) — a predicate cannot say what to fill on insert or which field to drop from the input type, and role rules belong to authorization. May sit on top of this marker later.
- **Session-level SQL rewriting** — parsing our own generated SQL back to inject predicates is fragile and blind to `$query`; the factory already holds the structured query.
- **`AsyncLocalStorage` claims** — hidden global state, and untypeable.
- **A public `uuid().tenantKey()` builder** — no single named declaration of the claim set. Kept as the internal mechanism a scope sets.
- **Permissive base with opt-in scoping**, and **strict base with a per-call `$bypassTenancy()`** — both make forgetting possible again, in one direction or the other. Processes that need to run unscoped are separate deployments, so the switch belongs on the client.
- **Throwing on a claim value in `data`** — the field is not in the type, so a mismatch can only arrive through an untyped spread; dropping it keeps spreads working.
- **Throwing on unknown keys in `$identityClaims`** — `{ ...jwt.claims }` always carries `sub` and `exp`. Declared claims are picked, the rest ignored, and a misspelled claim surfaces at the first tenant table.
- **Scoping a transaction client** (`tx.$identityClaims(…)`) — built, then dropped. Both orders converged on the same context, but no caller needs to scope a transaction it has already opened, so there is one order: scope, then transact.

## Consequences

- **A schema that adopts `tenantScope` immediately loses direct access to those tables** on a default client. Intended, and the reason `enforce` defaults to `true`.
- **Claim columns are ordinary columns in the emitted DDL.** No foreign key, no index, nothing `toJSON` reports — a client-side rule is not something introspection can observe on a real database. Applications declare the claim-leading index themselves.
- **Two schemas that used to build now throw**: one claim name with two data types across tables, and a `tenantKey` column that is not `notNull` and `readOnly`.
- **`ExecutionContextOptions` gains `identity` and `tenancy`**; `Kind` gains `TENANT_SCOPE`; `QueryClient` and `Models` gain defaulted generics. Source-compatible.
- **Isolation coverage is partial by construction.** `paginate`, `count` and ad-hoc joins do not exist yet; extending the PGlite isolation specs to them is an exit criterion on that work rather than a gap here.
- Changeset level `minor`.

## Docs

- [Tenancy (guide)](../guide/tenancy.md) — the whole feature from a consumer's side.
- [Schema (guide)](../guide/schema.md) — `tenantScope` and the claim rules.
- [Querying (guide)](../guide/querying.md), [Relations](../guide/relations.md), [Transactions](../guide/transactions.md) — what changes on each surface.
- [Runtime pipeline](../internals/runtime-pipeline.md) — the seam order, the predicate table, the insert fill.
- [Codec boundary](../internals/codec-boundary.md) — claim values are encoded inside `core`.
- [Architecture](../internals/architecture.md) — the identity client beside the transaction client.
