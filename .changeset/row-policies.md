---
"@dsqlbase/core": minor
"dsqlbase": minor
---

Row policies replace tenancy. DSQL has no row-level security, so the client enforces
RLS-shaped policies itself, on every statement it builds:

- `table.policy(name, (t) => ({ as, for, using, check }))` declares a policy with PostgreSQL RLS
  semantics: permissive OR-ed, restrictive AND-ed, default deny, update / delete also bounded by
  select policies. `using` bounds every read level, join, union branch, count, page and node
  lookup, and every update and delete; `check` is evaluated in the write's `RETURNING`, so a
  failing row fails the statement with nothing written.
- A failed check throws `PolicyViolationError` (`table`, `command`, `as`, `policies`, driver
  error as `cause`); `$transaction` rolls back and rethrows it without an OCC retry.
- `$onCreate` may return a `SQLNode`, filling a column at insert time without a DDL default.
- `createClient({ policies: { bypass: true } })` skips every policy on that client.
- `$withClaims` on a client that already carries settings merges the new values over the old;
  transactions inherit a client's settings.

**Breaking (`@dsqlbase/core`):**

- `TenantScopeDefinition`, the `tenantKey` column flag, `TenantKey`, `TenancyError`,
  `TenancyOptions`, `ExecutionContext.identity` / `tenancy`, `Table.tenantKeys`,
  `SchemaRegistry.claimKeys` and the claim-type validation are removed.

**Breaking (`dsqlbase`):**

- `tenantScope`, `$identityClaims`, `ClaimsOf`, `IdentityClient`, `VisibleFor`,
  `VisibleAliases`, `ClientOptions.tenancy` and the `TClaims` / `TEnforce` client generics are
  removed.
- Every table is on every client; a table with policies returns nothing to a client whose
  settings it does not match, rather than being absent from its type.

Docs: docs/guide/policies.md (new; replaces docs/guide/tenancy.md), docs/guide/schema.md, docs/guide/querying.md, docs/guide/relations.md, docs/guide/polymorphic-relations.md, docs/guide/pagination.md, docs/guide/transactions.md, docs/guide/global-ids.md, docs/guide/dsql-notes.md, docs/guide/README.md, docs/internals/runtime-pipeline.md, docs/internals/architecture.md, docs/internals/codec-boundary.md, docs/internals/dsql-capabilities.md, docs/decisions/0024-row-policies.md, docs/decisions/0005-tenant-client-visibility.md, docs/decisions/0006-client-tenancy.md, docs/decisions/README.md, README.md, packages/dsqlbase/README.md
