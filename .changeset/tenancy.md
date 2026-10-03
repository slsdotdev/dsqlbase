---
"dsqlbase": minor
"@dsqlbase/core": minor
---

Tenancy: declare a tenant boundary in the schema, and let the client enforce it. Aurora DSQL has no row-level security, so the client is the last place a multi-tenant application can be stopped from crossing tenants.

- **Declaring it.** `tenantScope(claims)` (from `dsqlbase/schema`) defines the claim columns every table in a boundary carries: `ws.table(name, columns)` merges them in, and `ws.columns()` spreads into any other table, a namespaced one included. Claim columns must be `notNull`; they are ordinary columns in the DDL.
- **Scoping a client.** `dsql.$identityClaims(claims)` derives a client for one request. Every read it builds carries the claim predicate ahead of your own `where`, at the root and at every joined level; every update and delete carries it too, and `create` fills the claim columns. A scoped client has no `$query`, `$execute` or `$identityClaims`, since raw SQL would bypass the predicate. `$transaction` inherits the scope.
- **Enforcing it.** By default a client without claims cannot reach a tenant table: it is absent from the client's type and throws `TenancyError` when a query is built, including through a join. `createClient({ tenancy: { enforce: false } })` lets an internal process run unscoped.
- **`.readOnly()`** marks a column as managed by something other than the caller. It reads like any column, but it is left out of `create`'s `data` and `update`'s `set`, in the types and at runtime. Claim columns are read-only.

**Breaking:**

- Adopting `tenantScope` takes those tables away from a default client until it is scoped — the point of `enforce: true`.
- A schema that gives one claim name two data types, or a claim column that is not `notNull`, now throws when the client is created.
- For direct `@dsqlbase/core` callers: an array `where` passed to `OperationsFactory` means all of its conditions (it used to keep only the first). Client queries never produce one.

Docs: docs/guide/tenancy.md, docs/guide/schema.md, docs/guide/querying.md, docs/decisions/0005-tenant-client-visibility.md, docs/decisions/0006-client-tenancy.md
