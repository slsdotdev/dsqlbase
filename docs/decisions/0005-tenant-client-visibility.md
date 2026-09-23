# 0005 — Tenant table visibility on the client

- **Date:** 2026-09-23
- **Status:** accepted provisionally — see [Open concerns](#open-concerns)
- **Proposal:** `client-tenancy.md` story B (local working artifact, not tracked)

## Context

A tenant table may only be read through a client that carries the claims to scope it. The runtime half of that is settled and unremarkable: `OperationsFactory._tenantPredicate` refuses to build an operation on a tenant table when the context has no identity, so the rule holds wherever a table is reached, including through a join that no type can see.

The question this record answers is the other half — what the *type* of a client should be. A rule enforced only at runtime turns a schema-wide invariant into a class of exception nobody sees until a request fails, and the whole reason for putting tenancy in the ORM was to stop relying on people remembering. So the client's type has to say which tables it can address.

That is harder than it sounds, because visibility is not a property of a query, a table, or a schema. It is a property of *which client object you are holding*: the same schema yields a base client that can address only global tables, an `enforce: false` client that can address everything, and one identity-scoped client per set of claims. Three different shapes over one schema, produced by ordinary method calls.

## Decision

- **Visibility is computed, not declared.** `VisibleFor<T, TClaims, TEnforce>` is the single rule — global tables always, tenant tables when the claims cover them in full, everything when enforcement is off — and both `QueryClient` and `TxClient` read it. Nothing lists tables by hand.
- **`Models<T, TVisible>` gained a visible-alias parameter**, defaulted to every alias, so existing uses are unchanged.
- **Claims are gathered schema-wide, not per table.** `ClaimsOf` intersects one object per table, because an identity is given as one object for the whole client. A claim declared twice with different value types collapses to `never`, which is the type-level mirror of the registry's data-type check.
- **A scoped client is a subtraction.** `IdentityClient` is `Omit<DatabaseClient, "$query" | "$execute" | "$identityClaims">`: raw SQL bypasses the predicate, so it is not offered, and claims are set in exactly one place, so it cannot be re-scoped.
- **Enforcement follows into transactions.** `DatabaseClient` carries `TClaims` and `TEnforce` purely so `$transaction` returns the right `TxClient`. Without them `dsql.$transaction((tx) => tx.invoices.findMany())` would typecheck on an enforcing client and throw — the exact failure this feature exists to prevent.
- **There is one derivation order: scope, then transact.** A transaction client cannot be scoped.

## Rejected alternatives

- **Runtime enforcement only, with every table on every client's type.** Honest about the mechanism, and it is what the runtime does anyway — but it makes a tenant leak a runtime exception rather than a compile error, and the point of the feature is that forgetting should not be possible.
- **A `$identityClaims` that mutates the client it is called on.** One client shape, no derived types. It also means a request handler can change what a shared client can see, and a query's SQL would depend on when it was built rather than on which client built it.
- **Scoping at the model client** (`dsql.invoices.forTenant(c).findMany()`) — per-call-site, so forgetting once is silent again, which is the bug being fixed.
- **A separate generated client type per scope**, emitted by a codegen step. Cleaner types, but this toolkit has no codegen step and adding one for this is out of proportion.
- **`tenantScope()` returning its own client factory**, so a scoped client is constructed rather than derived. Rejected with option A in the proposal: a namespaced tenant table has no home under it, and it makes the scope, rather than the schema, the thing a client is built from.

## Consequences

- **Enforcement is the default and is visible in the type**, so adopting `tenantScope` on an existing schema immediately removes those tables from the base client. Intended; named in the changeset.
- **Two independent statements of one rule.** `VisibleFor` and `_tenantPredicate` encode the same policy in different languages, with nothing tying them together. They agree today because tests assert both; nothing structural keeps them in step.
- **The runtime guards can only be tested through a cast**, because the types remove what the guards protect. That is a fair symptom rather than a test smell — the guards exist for callers who got past the types — but it is a symptom.
- Changeset level `minor`.

## Open concerns

Recorded because this was accepted with reservations, not because it is known to be wrong. A future record supersedes this one if any of them forces a change.

1. **A non-literal `enforce` silently shows every tenant table.** `TEnforce` is inferred from the argument, so `createClient({ tenancy: { enforce: someBoolean } })` infers `boolean`, the conditional distributes over `true | false`, and the union of both branches is every alias. The runtime still enforces, so this is a false promise in the type rather than a leak — but it fails permissive, which is the wrong direction. Passing a literal, or omitting the option, behaves correctly.
2. **Phantom type parameters on `DatabaseClient`.** `TClaims` and `TEnforce` describe none of its data and exist only to shape `$transaction`'s return. `TransactionClient` carried the same two until lint pointed out they were unused, which is the same objection arriving from a different direction.
3. **`Omit` is subtractive.** Every method added to `DatabaseClient` is implicitly available on a scoped client unless someone remembers to extend the omit list. A capability split — a narrower base that `DatabaseClient` extends with the raw-SQL methods — would make the same distinction additive, and would let `IdentityClient` be a class rather than a computed type.
4. **Visibility is per client object, so it cannot survive a boundary** that erases the type: a client stored as `QueryClient<Schema>` in a container, or handed to a function typed against the base client, is back to runtime-only enforcement.

## Docs

- [Runtime pipeline](../internals/runtime-pipeline.md) — the `WHERE` seam, identity on the context, the insert fill.
- [Architecture](../internals/architecture.md) — the identity client beside the transaction client.
- [Tenancy (guide)](../guide/tenancy.md) — what a scoped client can and cannot do.
