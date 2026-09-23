---
"dsqlbase": minor
---

Declare a tenant boundary in the schema and let the client enforce it.

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
