---
proposal: client-tenancy
status: draft
owner: silviu
created: 2026-09-20
---

# Client tenancy: tenant scopes, identity claims, and predicate injection in the operations factory

Prime: `.claude/prime/03-client.md` Topic 3. Review context: `.claude/prime/00-review.md`, `docs/internals/runtime-pipeline.md` ("Known gaps": `_validateWhereExpression` stub, no hooks / derived-client factory), `docs/internals/dsql-capabilities.md` (no row-level security). Depends on `.claude/proposals/schema-prerequisites.md` stories 2 (`Table.alias` and `attachModels`) and 9 (one field namespace per table). Composes with `.claude/proposals/client-pagination.md` and `.claude/proposals/client-runtime-joins.md`, both of which already route every read through the seam this proposal fills.

## Problem

The reference application is tenant-based: a workspace is the tenant and every tenant table carries a `workspace_id` column. Today the application appends `workspaceId` to every `where`, every `create`, every nested join by hand. Forgetting once is silent — the query returns another tenant's rows or writes a row into no tenant — and DSQL offers nothing underneath to catch it: there is no row-level security and permissions are schema-level grants (`docs/internals/dsql-capabilities.md`). The ORM is therefore the last line of defence, not a convenience layer, and the boundary has to be applied below the point where callers write queries.

### What the code does today (verified 2026-09-20)

- `ExecutionContext` (`packages/core/src/runtime/context.ts`) is `{ session, dialect, schema, operations }`. There is no slot for identity and no hook or middleware anywhere in the chain. `ModelClient` and `RequestNormalizer` bind to a context at construction; the only derived-client pattern is `createTransactionRunner` (`packages/dsqlbase/src/client/transaction/transaction-client.ts`): spread the context, swap `session`, re-attach one `ModelClient` per table.
- `OperationsFactory._validateWhereExpression(table, where)` (`packages/core/src/runtime/operation.ts`) returns `where` (or `where[0]` for arrays). It is the natural injection seam, but it is called **conditionally** — `args.where ? this._validateWhereExpression(table, args.where) : undefined` in `_resolveSelectParams`, `createUpdateOperation` and `createDeleteOperation` — so a `findMany({})` never reaches it.
- Nested joins (`_resolveJoinEntries` → `_resolveSelectParams(target)`), and, per their proposals, `paginate`, `count`, `$findByGlobalId` and union branches all pass through `_resolveSelectParams`. One seam covers every read.
- Inserts have no seam: `_resolveInsertEntries` walks every column and calls `column.getInsertValue(value)`, which falls back to `onCreate()` and then `DEFAULT`. `_resolveUpdateEntries` refuses primary-key columns and nothing else.
- `RequestNormalizer._getMutationEntries` (`packages/dsqlbase/src/client/model/normalizer.ts`) passes every known field through; there is no notion of a column the caller may not write.
- `BaseClient.$query` / `$execute` (`packages/dsqlbase/src/client/database/base.ts`) hand SQL straight to the session.
- Types (`packages/dsqlbase/src/client/model/base.ts`): `Models<T>` maps every alias to a `ModelClient`; `CreateValuesOf` derives required-ness from `notNull` / `hasDefault`, so a `workspaceId: uuid().notNull()` is a required input today.
- Schema side: `TableDefinition` (`packages/core/src/definition/table.ts`) has no marker of any kind. `NamespaceDefinition.table()` is the existing "constructor wrapper" and `domain.column()` / `$enum().column()` the existing "reusable definition → fresh column instance" pattern. `SchemaRegistry._validateAndTransformSchema` (`packages/core/src/runtime/registry.ts`) keeps only `TableDefinition` and `RelationsDefinition` exports and ignores everything else.

## Decisions taken during grilling

1. **App-level enforcement, no RLS.** DSQL has none; the design stays declarative (a table plus its claim columns is exactly what an RLS policy would need if DSQL ever ships one) but is not built around that possibility.
2. **Process-wide mode, decided at `createClient`.** `tenancy: { enforce }` governs what happens when a tenant table is reached **without claims**: enforce (default) removes it from the type and throws at runtime, root or nested; `enforce: false` runs unscoped. API Lambdas and internal-process Lambdas are separate deployments with separate DB roles, so a per-process switch is the right granularity. `$identityClaims` injects in both modes.
3. **The tenant column is system-managed, in every client.** Never writable through the model client (removed from `CreateValuesOf` / `UpdateValuesOf`, stripped at runtime so a spread input is harmless), always readable, selectable, filterable, orderable. Its value comes from claims or from nowhere — there is no scoped-vs-unscoped rule set to keep in mind beyond decision 2.
4. **Insert without claims always throws**, in both modes: the column is `notNull` and there is nothing to fill. Moving a row between tenants is not a model-client operation; it is `$query` on an `enforce: false` client.
5. **`$query` / `$execute` exist on the base client only.** A scoped client has no raw methods, so no one can believe raw SQL is tenant-safe.
6. **Equality on claim columns only.** Role-dependent row rules ("admins see all") belong to the application's permission policies and stay there.
7. **Claims are an explicit argument** — `dsql.$identityClaims(claims)` — typed from the schema. No `AsyncLocalStorage`.
8. **Claim columns must be `notNull`**; no automatic index (DSQL indexes are `CREATE INDEX ASYNC` and the tenant column is almost always the leading column of an application-defined composite index anyway — the guide says so); no primary-key restriction (a composite `(workspace_id, id)` key is allowed; the guid proposal then treats the table as not a `Node`).
9. **One scope per table, given by construction; several scopes per schema allowed.** No schema-wide check.
10. **Re-scoping a scoped client throws**; identity is set in exactly one place.

## Decision

Add a **tenant scope** definition to the schema layer, a **system-managed (read-only) column marker** to `ColumnConfig`, an **identity slot** on `ExecutionContext`, a `tenancy` option on `createClient`, `BaseClient.$identityClaims(claims)` returning an identity-scoped client, and turn `_validateWhereExpression` into an **unconditional** `_resolveWhere` that AND-s the tenant predicate for every select, update and delete — root or nested — while `_resolveInsertEntries` fills tenant columns from the claims. Types follow the column markers: no new generics on `Table` or `TableDefinition`; visibility of tenant tables is a property of the client object, never of the query arguments.

### Rejected options (one line each)

- **A. `tenantScope(claims).table()` as the only constructor** — a namespaced tenant table has no home (`app.table()` and `ws.table()` cannot both build it); kept only as sugar over the reusable-definition form.
- **B. Generic query policies (`policy(table, { using, check })`)** — a predicate cannot say what to fill on insert or which column to drop from the type; role rules are application authorization (decision 6); may sit *on top of* this marker later.
- **C. Schema per tenant with DSQL grants** — the only DB-enforced boundary, but one schema per workspace does not fit the tenant count, every migration multiplies by tenants, and cross-tenant reporting becomes impossible.
- **D. Session-level SQL rewriting** — parsing our own SQL text back to inject predicates is fragile and blind to `$query`; the factory already has the structured query.
- **Chained `table(...).tenant(ws)`** — must return a new `TableDefinition` with widened columns, so constraints declared before it are lost or call order becomes a rule.
- **Column-level public marker (`uuid().tenantKey()`)** — no single named declaration of "these are the claims"; kept as the internal mechanism the scope sets.
- **Strict base + `$bypassTenancy()` / `$system()` principal** — per-call-site escape is unnecessary when API and internal processes are separate deployments (decision 2).
- **Permissive base with opt-in scoping** (Prisma-extension style) — forgetting is silent, which is the bug being fixed.
- **Throw on a mismatching tenant value in `data`** — the column is not in the type, so a mismatch can only arrive through an untyped spread; stripping keeps spreads working and the claim always wins.
- **`AsyncLocalStorage` claims** — hidden global state, untypeable.
- **Throw on unknown keys in `$identityClaims`** — `{ ...jwt.claims }` always carries `sub` / `exp`; declared claims are picked, the rest ignored, and a misspelled claim surfaces at the first tenant-table access.

## API

### Schema

```ts
import { tenantScope, table, namespace, uuid, text } from "dsqlbase/schema";

export const ws = tenantScope({
  workspaceId: uuid("workspace_id").notNull(),
});

export const workspaces = table("workspaces", {              // global table
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const invoices = ws.table("invoices", {               // sugar: claim columns merged in
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull(),
});

const app = namespace("app");
export const audit = app.table("audit", {                    // any constructor, same marker
  ...ws.columns(),
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
}).primaryKey((c) => [c.workspaceId, c.id]);
```

Rules:
- Every claim column must be `notNull`; `tenantScope()` throws otherwise.
- `ws.table(name, cols)` throws if `cols` redefines a claim field name. `ws.columns()` returns fresh instances every call, so a scope can be used by any number of tables.
- The claim key is the field name (`workspaceId`). Two scopes that declare the same field name declare the same claim; the same claim name must have the same `dataType` in every table (checked at `SchemaRegistry` build).
- A claim field is a field like any other for story 9: it may not collide with a relation name.
- Exporting `ws` from the schema module is allowed and ignored by the registry.

### Client

```ts
// api lambda — enforce is the default
export const dsql = createClient({ schema, session });

dsql.workspaces.findMany({});                                 // global table: fine
dsql.invoices;                                                // type error: property does not exist
                                                              // (runtime: TenancyError, also when reached through a join)

const db = dsql.$identityClaims({ workspaceId: claims.workspace_id });

await db.invoices.findMany({});                               // … WHERE "invoices"."workspace_id" = $1
await db.invoices.create({ data: { number: "INV-1" } });      // workspace_id filled from the claim
await db.invoices.create({ data: { ...input } });             // a workspaceId inside input is dropped; claim wins
await db.invoices.update({ where: { id }, set: { number } }); // … WHERE "invoices"."workspace_id" = $1 AND "invoices"."id" = $2
await db.workspaces.findMany({ join: { invoices: true } });   // lateral: … WHERE "invoices"."workspace_id" = $1 AND <correlation>
await db.$transaction(async (tx) => { /* tx is scoped */ });
db.$query;                                                    // type error; runtime TenancyError

// internal-process lambda
export const dsql = createClient({ schema, session, tenancy: { enforce: false } });

await dsql.invoices.findMany({});                             // unscoped
await dsql.invoices.update({ where: { id }, set: { number } });
await dsql.invoices.create({ data: { number } });             // TenancyError: nothing to fill
await dsql.$identityClaims({ workspaceId }).invoices.create({ data: { number } });   // the way to create
await dsql.$query(sql`UPDATE invoices SET workspace_id = ${to} WHERE id = ${id}`); // moving a row: raw, deliberate
```

`ClientOptions.tenancy?: { enforce?: boolean }` (default `{ enforce: true }`). `$identityClaims<TClaims extends Partial<ClaimsOf<Schema<T>>>>(claims: TClaims): IdentityClient<T, TClaims>` on the base client and on an unscoped transaction client; throws on a scoped client. Partial claims are allowed: a table whose claims are not all present is absent from the scoped client's type and throws at runtime.

## Generated SQL

Tenant predicate first, then the caller's `where`, then anything a sibling feature appends (correlation, keyset).

```sql
-- db.invoices.findMany({ where: { number: { beginsWith: "INV" } } })
SELECT "invoices"."id", "invoices"."workspace_id", "invoices"."number"
FROM "invoices"
WHERE "invoices"."workspace_id" = $1 AND "invoices"."number" LIKE $2

-- db.invoices.create({ data: { number: "INV-1" } })
INSERT INTO "invoices" ("id", "workspace_id", "number") VALUES (DEFAULT, $1, $2) RETURNING …

-- db.workspaces.findMany({ join: { invoices: { where: { number: { beginsWith: "INV" } } } } })
SELECT "__t1"."id", "__t1"."name", "__j1"."data" AS "invoices"
FROM "workspaces" AS "__t1"
LEFT JOIN LATERAL (
  SELECT COALESCE(json_agg(row_to_json("__t2")), '[]') AS "data"
  FROM (
    SELECT "__t2"."id", "__t2"."workspace_id", "__t2"."number"
    FROM "invoices" AS "__t2"
    WHERE "__t2"."workspace_id" = $1 AND "__t2"."number" LIKE $2 AND "__t2"."workspace_id" = "__t1"."id"
  ) AS "__t2"
) AS "__j1" ON true
```

(Aliases per prerequisite story 3; the correlation is AND-ed after `_resolveWhere` per the joins proposal.) A `paginate` adds the keyset predicate after the same AND; a `count` is `SELECT count(*) … WHERE "invoices"."workspace_id" = $1 AND …`.

## Runtime design

**Definition layer** (`packages/core/src/definition/`)
- `tenant.ts` (new): `TenantScopeDefinition<TClaims extends Record<string, AnyColumnDefinition>>` with `kind: Kind.TENANT_SCOPE`, `columns(): TClaims` (clones each claim definition and sets `_tenantKey = true`, `_readOnly = true`) and `table(name, cols)` (`new TableDefinition(name, { columns: { ...this.columns(), ...cols } })`). Constructor validates `notNull`; `table()` validates field-name overlap. `Kind` gains `TENANT_SCOPE`.
- `column.ts`: `ColumnConfig.tenantKey: boolean`, `ColumnConfig.readOnly: boolean`; `ColumnDefinition._tenantKey` / `_readOnly` (internal — no public builder methods in v1, the scope is the only way in); `toJSON` unchanged (migrations do not care).
- `packages/dsqlbase/src/schema/tenant.ts` (new): `tenantScope(claims)` export; re-exported from `dsqlbase/schema`.

**Runtime layer** (`packages/core/src/runtime/`)
- `column.ts`: `Column.tenantKey`, `Column.readOnly`.
- `table.ts`: `Table.tenantKeys: Column[]` computed in `_buildColumns`.
- `registry.ts`: `SchemaRegistry.claimKeys: Map<claim, dataType>` built in `_buildTables`; throws when the same claim name appears with a different `dataType`. `getTable` / `attachModels` unchanged.
- `context.ts`: `ExecutionContextOptions.identity?: Record<string, unknown>`, `options.tenancy?: { enforce: boolean }` (inside the `options` bag the pagination proposal introduces); `ExecutionContext.identity` readonly.
- `errors.ts` (or alongside pagination's `InvalidCursorError`): `TenancyError extends Error { table: string; claim?: string }`. Thrown synchronously at build time — when `findMany()` is called, before `execute`.
- `operation.ts`:
  - `_tenantPredicate(table): SQLNode | undefined` — no `tenantKeys` → `undefined`; identity present → for each key, missing claim → `TenancyError(table, claim)`, else `eq(column, new SQLParam(value, column.codec.encode))`, AND-ed; identity absent → `enforce` ? `TenancyError(table)` : `undefined`. Encoding happens here in core, so this does not depend on prerequisite story 7.
  - `_validateWhereExpression` → `_resolveWhere(table, where?)`, **always called**: `and([tenantPredicate, ...where])`, `undefined` when nothing remains. Arrays become a proper `and` (removes the `where[0]` stub). Callers: `_resolveSelectParams` (root and every nested target — `_resolveJoinEntries` AND-s the correlation after it, per the joins proposal; `createPaginateOperation` AND-s the keyset after it, per pagination), `createCountOperation`, `createUpdateOperation`, `createDeleteOperation`.
  - `_resolveInsertEntries`: for each `table.tenantKeys` column, the row value is `column.getInsertValue(identity[key])`; identity or key absent → `TenancyError`, both modes. Runs before the generic `getInsertValue` fallback, so `onCreate` / `DEFAULT` never apply to a tenant key.
  - `_resolveInsertEntries` / `_resolveUpdateEntries`: a read-only column that arrives with a value throws `Cannot write read-only column "…"` next to the existing PK refusal. Core stays strict; leniency lives in the normalizer.

**Client layer** (`packages/dsqlbase/src/client/`)
- `model/normalizer.ts`: `_getMutationEntries` drops fields whose `column.readOnly` is set (silent — the spread safety).
- `database/base.ts`: `$identityClaims(claims)` — throws if `this._ctx.identity` is set; picks the registry's `claimKeys` from the argument (unknown keys ignored); a declared claim present as `null` / `undefined` throws; builds `new ExecutionContext({ ...this._ctx, identity: picked })` and attaches models through story 2's `attachModels`; returns an `IdentityClient`. `$query` / `$execute` gain `if (this._ctx.identity) throw new TenancyError(…)`.
- `create.ts`: forwards `options.tenancy` (default `{ enforce: true }`) into the context options.
- `transaction/transaction-client.ts`: no change needed — it already spreads the parent context, so `identity` and `options` carry into the transaction context and into the OCC retry rebuild.
- `model/client.ts`: no change. Visibility is decided by which models are attached and by the types, not inside `ModelClient`.

**Derivation orders converge.** `dsql.$identityClaims(c).$transaction(tx => …)` and `dsql.$transaction(tx => tx.$identityClaims(c)…)` both produce `{ session: tx, identity: c }`. Batching `dsql.$transaction([scoped.invoices.findMany(…)])` is safe because the `ExecutableQuery` has its SQL baked at build and `op.clone(session)` only swaps the session — documented as the reason cross-client batching is allowed.

## Type design

```ts
// packages/dsqlbase/src/client/model/base.ts
export type TenantKeysOf<T extends AnyTable> =
  { [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { tenantKey: true } ? K : never }[FieldNamesOf<T>];
export type ReadOnlyFieldsOf<T extends AnyTable> =
  { [K in FieldNamesOf<T>]: ColumnTypeOf<T, K> extends { readOnly: true } ? K : never }[FieldNamesOf<T>];

export type CreateValuesOf<T extends AnyTable> =
  { [K in Exclude<RequiredFieldsOf<T>, ReadOnlyFieldsOf<T>>]: ValueTypeOf<ColumnTypeOf<T, K>> } &
  { [K in Exclude<OptionalFieldsOf<T>, ReadOnlyFieldsOf<T>>]?: ValueTypeOf<ColumnTypeOf<T, K>> };
export type UpdateValuesOf<T extends AnyTable> =
  { [K in Exclude<FieldNamesOf<T>, ReadOnlyFieldsOf<T>>]?: ValueTypeOf<ColumnTypeOf<T, K>> };
// WhereExpressionOf, FieldSelectionOf, OrderByExpressionOf, QueryArgs, FindOneArgs: unchanged.

// packages/dsqlbase/src/client/database/index.ts
type Aliases<TSchema extends AnySchema> = keyof RuntimeTables<TSchema> & string;

export type ClaimsOf<TSchema extends AnySchema> = UnionToIntersection<{
  [A in Aliases<TSchema>]: {
    [C in TenantKeysOf<TableByAlias<TSchema, A>>]: ValueTypeOf<ColumnTypeOf<TableByAlias<TSchema, A>, C>>;
  };
}[Aliases<TSchema>]>;

type VisibleAliases<TSchema extends AnySchema, TClaims> = {
  [A in Aliases<TSchema>]: [TenantKeysOf<TableByAlias<TSchema, A>>] extends [keyof TClaims] ? A : never;
}[Aliases<TSchema>];

export type Models<TSchema extends AnySchema, TVisible extends Aliases<TSchema> = Aliases<TSchema>> = {
  readonly [A in TVisible]: ModelClient<TableByAlias<TSchema, A>, …>;
};

export type QueryClient<T extends DefinitionSchema, TEnforce extends boolean = true> =
  DatabaseClient<T> & Models<Schema<T>, TEnforce extends true ? VisibleAliases<Schema<T>, {}> : Aliases<Schema<T>>>;

export type IdentityClient<T extends DefinitionSchema, TClaims> =
  Omit<DatabaseClient<T, TClaims>, "$query" | "$execute" | "$identityClaims"> &
  Models<Schema<T>, VisibleAliases<Schema<T>, TClaims>>;

export type TxClient<T extends DefinitionSchema, TClaims = never> =
  ([TClaims] extends [never] ? TransactionClient<T> : Omit<TransactionClient<T, TClaims>, "$query" | "$execute" | "$identityClaims">) &
  Models<Schema<T>, [TClaims] extends [never] ? Aliases<Schema<T>> /* or enforce-filtered */ : VisibleAliases<Schema<T>, TClaims>>;
```

- `createClient<TSchema, TOptions extends ClientOptions<TSchema>>(options: TOptions): QueryClient<TSchema, EnforceOf<TOptions>>`; `EnforceOf` reads `TOptions["tenancy"]["enforce"]`, defaulting to `true`. The literal `false` is inferred because the property is constrained to `boolean`.
- `BaseClient<TDefinition, TClaims = never>` carries `TClaims` only so `$transaction` can return `TxClient<T, TClaims>` and the enforce flag can flow to the unscoped transaction client's visible aliases.
- `VisibleAliases<…, {}>` is "tables with no tenant keys" (`[never] extends [never]` is true, anything else is not) — the enforce-mode base client.
- `ClaimsOf` intersects per-table claim objects; the same claim with two value types collapses to `never` at the call site, mirroring the registry's `dataType` check.
- Type-level tests (`vitest run --typecheck`) cover: tenant alias absent on enforce client, present on `enforce: false` and on the identity client; identity client with partial claims hides the tables that need more; `CreateValuesOf` / `UpdateValuesOf` without the claim; `where` still accepts the claim; `$query` absent on identity and scoped tx clients; `ClaimsOf` shape; excess-property error on a misspelled claim literal.

## DSQL constraints

Nothing new to verify. The predicate is a plain equality on a parameter; the insert is a plain value. No RLS, no session variables, no triggers are used (all unsupported per `docs/internals/dsql-capabilities.md`).

## Failure modes

| Situation | Behaviour |
|---|---|
| Claim column without `notNull` | throws at `tenantScope()` and at `Table` build |
| `ws.table(name, cols)` where `cols` redefines a claim field | throws at definition |
| Same claim name with different `dataType` across tables | throws at `SchemaRegistry` build |
| Claim field name equals a relation name | throws (prerequisite story 9) |
| Tenant table on enforce-mode base client, root | type error; `TenancyError(table)` at build |
| Tenant table reached through a join (relation, filtered, ad-hoc, count) without claims, enforce | `TenancyError(target table)` at build — the types cannot see this, the runtime does |
| Same, `enforce: false` | runs unscoped |
| Insert into tenant table without claims, either mode | `TenancyError(table, claim)` |
| Scoped client missing one of a table's claims | table absent from the type; `TenancyError(table, claim)` at build |
| `$identityClaims` with a declared claim set to `null` / `undefined` | throws |
| `$identityClaims` with unknown keys (`sub`, `exp`) | ignored; only declared claims are kept on the context |
| Misspelled claim in a spread object | not caught at intake; `TenancyError(table, claim)` at first tenant-table access |
| `$identityClaims` on an already scoped client | throws |
| Tenant column in `data` / `set` through the model client | dropped by the normalizer (claim wins); type error for a literal |
| Tenant column in `data` / `set` reaching the factory directly | `Cannot write read-only column` |
| `$query` / `$execute` on a scoped client | type error; `TenancyError` at runtime |
| Scoped `ExecutableQuery` batched in an unscoped `$transaction([...])` | runs with the predicate — SQL was baked at build |
| `update` / `delete` without `where` on a scoped client | still a type error (`where` required, unchanged); the predicate alone would otherwise be tenant-wide |
| `where: { workspaceId: other }` on a scoped client | `workspace_id = $claim AND workspace_id = $other` → empty result, never another tenant's rows |

## Interplay

- **Runtime joins** (`client-runtime-joins.md`): every target passes through `_resolveSelectParams(target)` → `_resolveWhere(target)`; the correlation is AND-ed after. An ad-hoc `from` naming a tenant table is guarded exactly like a relation; a `count` entry too. `ColumnRef` values in a callback `where` are references, so a tenant predicate on the target cannot be satisfied by a parent ref. Nothing to change in that proposal.
- **Pagination** (`client-pagination.md`): `createPaginateOperation` calls `_resolveSelectParams` first, so the keyset predicate lands after the tenant predicate; `createCountOperation` must call `_resolveWhere` (it already calls the seam). Cursors carry order keys, never a tenant boundary; a cursor forged from another tenant's row positions the keyset but the predicate still bounds the rows.
- **Global ids** (`schema-guid.md`): `$findByGlobalId` / `$listByGlobalId` go through the model clients, so they inherit the rules and exist on the identity client. A composite `(workspace_id, id)` primary key is allowed here and makes the table not a `Node` there — documented in both guides.
- **Polymorphic relations** (`schema-polymorphic-relations.md`): each union branch is built through `_resolveSelectParams(memberTable)`; a union mixing tenant and global members works — the predicate applies per branch. A union client on the enforce base is visible only if none of its members is a tenant table (union alias visibility follows the strictest member).
- **Embeddables** (`schema-embeddable-objects.md`): a claim column is a flat column; groups are independent. `readOnly` is a leaf-level flag; a future managed group would set it per leaf.
- **Prerequisites** (`schema-prerequisites.md`): story 2 provides `attachModels` (used by `$identityClaims`); story 9 covers claim-vs-relation collisions. Story 7 (codec-aware where) is not required — the predicate is encoded in core. No amendment needed.
- **Migrations**: none. Tenant keys are ordinary columns in `toJSON`; no FK, no index is emitted. The guide recommends `(workspace_id, …)`-leading indexes and the application declares them.
- **gqlbase / middy**: one `dsql.$identityClaims(mapClaims(jwt))` per request in a `before` middleware, put on the context; resolvers use only that client. The mapping from JWT claim names to schema claim names is the application's.

## Stories, ordering, changesets

All on the fixed release group. Prerequisites: stories 2 and 9 of `schema-prerequisites.md`.

### A. Read-only columns and the unconditional where seam

- **Change.** `ColumnConfig.readOnly`, `ColumnDefinition._readOnly`, `Column.readOnly`; normalizer strips read-only fields from `data` / `set`; factory refuses read-only writes; `CreateValuesOf` / `UpdateValuesOf` exclude read-only fields. `_validateWhereExpression` → `_resolveWhere`, always called, arrays AND-ed. No tenant behaviour yet; `readOnly` has no public setter until story B.
- **Tests.** `operation.test.ts`: where-less select/update/delete still build; array `where` produces an `AND`; read-only write refused. `normalizer.test.ts`: read-only field dropped. Type tests: `CreateValuesOf` excludes a `readOnly: true` fixture column.
- **Docs.** `docs/internals/runtime-pipeline.md` (gap row "`_validateWhereExpression` stub" removed; read-only columns). Changeset `patch` (`Docs: docs/internals/runtime-pipeline.md`).

### B. Tenant scope, identity context, predicate injection

- **Change.** `TenantScopeDefinition` + `tenantScope()`; `ColumnConfig.tenantKey`; `Table.tenantKeys`; `SchemaRegistry.claimKeys` + `dataType` check; `ExecutionContext.identity` and `options.tenancy`; `TenancyError`; `_tenantPredicate` inside `_resolveWhere`; insert fill; `ClientOptions.tenancy` (default enforce); `BaseClient.$identityClaims`; `$query` / `$execute` guard; `TenantKeysOf`, `ClaimsOf`, `VisibleAliases`, `Models` filter, `QueryClient<T, TEnforce>`, `IdentityClient`, `TxClient<T, TClaims>`.
- **Tests.** Definition: `notNull` and overlap validation; `columns()` returns fresh instances. Registry: `claimKeys`, `dataType` mismatch. Factory: predicate on select/update/delete/nested join, ordering before caller `where`, insert fill, insert without claims throws in both modes, enforce vs off on reads, missing claim, encoded value. Client: `$identityClaims` picks/ignores/throws, re-scope throws, both transaction orders, batching a scoped query, `$query` guard. Type tests as listed under Type design. PGlite e2e (`packages/tests`): fixture gains `ws = tenantScope(…)` and one tenant table with a relation from a global table; specs for cross-tenant isolation on find / join / paginate / count / update / delete, insert fill, `enforce: false` client.
- **Docs.** New `docs/guide/tenancy.md`; `schema.md`, `querying.md`, `transactions.md`, `relations.md`; `docs/internals/runtime-pipeline.md`, `architecture.md`. Changeset `minor` (`Docs:` those pages).

### Breaking surface

- `QueryClient<T>` gains a defaulted `TEnforce` generic; `Models<T>` gains a defaulted `TVisible` generic — source-compatible for existing callers.
- `CreateValuesOf` / `UpdateValuesOf` exclude read-only fields — no existing column is read-only, so no observable change until a schema uses `tenantScope`.
- Core: `_validateWhereExpression` renamed and now unconditional; `SelectOperationArgs` / `UpdateOperationArgs` / `DeleteOperationArgs` unchanged in shape; array `where` semantics change from "first element" to `AND` (the stub's behaviour was never documented as intended). `ExecutionContextOptions` gains optional fields. `Kind` gains a member.
- A schema that introduces `tenantScope` with the default `createClient` immediately loses direct access to those tables — intended, and the reason `enforce` defaults to `true`; stated in the changeset.

## Test plan

Unit per story above; the PGlite fixture and specs in story B. Isolation specs seed two workspaces and assert that a scoped client never returns, updates or deletes the other workspace's rows through any read path (`findMany`, `findOne`, nested `join`, ad-hoc join once the joins proposal lands, `paginate`, `count`) and that `create` lands in the right workspace. Failing tests that expose a leak stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): new `tenancy.md` (why app-level, `tenantScope`, `ws.table` vs `ws.columns()`, `createClient({ tenancy })` and the default, `$identityClaims`, what a scoped client can and cannot do, system-managed columns, both transaction orders, internal-process pattern including `$identityClaims` for creates and `$query` for moving rows, index advice, the nested-join runtime guard, JWT mapping example); `schema.md` (`tenantScope`, claim rules, read-only columns, composite PK note); `querying.md` (tenant predicate ordering, tenant column filterable but not writable, `TenancyError`); `transactions.md` (scoped transactions, batching across clients); `relations.md` (relations between tenant and global tables, what is and is not injected).
- **Internals** (`docs/internals/`): `runtime-pipeline.md` (gap rows "`_validateWhereExpression` stub" and "No hooks / derived-client factory" removed; `_resolveWhere` seam order — tenant, caller, correlation / keyset; identity on the context; read-only columns; insert fill), `architecture.md` (identity client next to the transaction client), `dsql-capabilities.md` (no change; the RLS line already exists), `codec-boundary.md` (tenant predicate values encoded in core).
- **Decision record**: `docs/decisions/0009-client-tenancy.md` on acceptance (after `0008-client-runtime-joins`); this proposal is then deleted.
- **Stale lines**: `docs/internals/runtime-pipeline.md` "There are **no hooks, middleware, or interceptors**" stays true and gains "identity is carried by the context, not by a hook"; `packages/dsqlbase/README.md` gets a tenancy paragraph; `CLAUDE.md` unchanged.
- **Cross-topic notes to carry forward**: the joins proposal's "correlation AND-ed after `_resolveSelectParams`" and pagination's "keyset AND-ed after" are the contracts this proposal relies on — both already written; the guid proposal documents composite-PK tenant tables as non-nodes; the polymorphic proposal notes union alias visibility follows the strictest member.
