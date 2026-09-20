---
proposal: schema-guid
status: draft
owner: silviu
created: 2026-09-19
---

# Global unique ids (`guid`), record metadata (`$$meta`), and lookup by global id (`$findByGlobalId`)

Prime: `.claude/prime/02-schema.md` Topic 1. Review context: `.claude/prime/00-review.md`, `docs/internals/runtime-pipeline.md`, `docs/internals/codec-boundary.md`.

## Problem

The API layer exposes a `Node` interface and `query { node(id: ID!) }`. Every id that leaves the ORM must be an opaque global id that identifies both the row and its table, and any row must be retrievable from that id alone. Two constraints from the consumer:

1. A joined result such as `{ users { id name } workspace { id displayName } }` must wrap `users.id` and `workspace.id` each with *their own* table.
2. Relation-key columns (`users.workspaceId`) are not exposed to GraphQL but are compared internally against `workspace.id`; `user.workspaceId === user.workspace.id` must hold without the application unwrapping.

The consumer stack (verified 2026-09-19 from the repositories): `gqlbase` generates both the AppSync schema and the dsqlbase schema (`packages/plugins/src/dsql/DsqlBaseSchemaGeneratorPlugin/DsqlBaseSchemaGeneratorPlugin.ts` emits `table()`, `uuid("id").primaryKey().defaultRandom()`, and `belongsTo`/`hasOne`/`hasMany` from `@model` and relation directives; `relayPreset()` adds `interface Node { id: ID! }` and `Query.node(id: ID!): Node`). `middy-appsync` routes one Lambda by `(parentTypeName, fieldName)`; every resolver is a middy handler with `before`/`after` middleware and `formatResult` is the single response choke point. AppSync does not allow user-defined scalars (docs: "AWS AppSync doesn't support the creation of user-defined (custom) scalars"), so `ID` stays `ID` and wrapping is always code. Today resolvers pass raw uuids straight through (`where: { id: args.id }`) and spread dsqlbase rows into results.

### What the code does today (verified)

- The column codec runs on read (`Column.resolve` in `packages/core/src/runtime/column.ts`, including nested join rows via `_createResultResolver` in `packages/core/src/runtime/operation.ts`), on insert/update values (`getInsertValue` / `getUpdateValue`), and in `ColumnDefinition.default()`. It does **not** run on where values: `packages/dsqlbase/src/client/model/normalizer.ts` hands raw values to `sql.eq/...` (`packages/core/src/sql/tag.ts`), which wraps them in a bare `SQLParam`. Known gap in `docs/internals/codec-boundary.md`.
- `Column` knows its `table`; `ColumnDefinition` does not. Any table-derived behaviour has to be bound when `Table._buildColumns` (`packages/core/src/runtime/table.ts`) constructs the runtime column.
- `SchemaRegistry` (`packages/core/src/runtime/registry.ts`) keys tables by alias and by DB name, but there is no alias-from-name lookup and no models map on `ExecutionContext`. `createClient` (`packages/dsqlbase/src/client/create.ts`) and `createTransactionRunner` (`packages/dsqlbase/src/client/transaction/transaction-client.ts`) each attach `ModelClient`s by alias with duplicated loops.
- Runtime `Table` exposes `columns` and `relations` only; a table-level `PrimaryKeyConstraintDefinition` in `TableDefinition._constraints` is invisible at runtime.
- `FieldResolver` (`[fieldName, AnyColumn | FieldResolver[]]`, exported from `@dsqlbase/core`) carries no table context on the nested branch.
- `ColumnDefinition.toJSON` / `TableDefinition.toJSON` never serialize codecs; a column with `dataType: "uuid"` is migration-neutral regardless of its codec.
- The e2e fixture (`packages/tests/src/db/schema/schema.ts`) already has an alias that differs from the table name (`members` → `team_members`).
- Side finding, out of scope: `PrimaryKeyConstraintDefinition.include()` in `packages/core/src/definition/constraint.ts` assigns `_columns` instead of `_include`.

## Decisions taken during grilling

| # | Question | Decision |
|---|---|---|
| 1 | Where do wrapped ids appear? | Everywhere the ORM returns rows (find/create/update/delete, joins, `return`). Inputs accept wrapped or raw. Codec-aware `where` is a prerequisite story. |
| 2 | How do relation-key columns learn their target? | `guid(columnName, key?)`: the optional second argument is a plain string that overrides the auto-inferred owning-table key. No thunk reference (rejected: unclear against composite keys, import cycles). Relations validate that each `from[i]`/`to[i]` pair agrees on data type and, for guid columns, on key. |
| 3 | Payload and format | Ours to choose; the client treats `id` as opaque and gqlbase generates the declarations. Payload is `[tableKey, { [pkField]: value }]`, prefixed and base64url-encoded, so the primary-key column is never assumed to be `id` and composite keys are representable; the ORM validates the payload against the registry rather than trusting it. **Keys are aliases**: the table key is the schema alias (the key in the definition object, `members` not `team_members`) and pk fields are field aliases (`teamId` not `team_id`) — the same names the client API uses, and the names gqlbase derives from GraphQL typenames and fields. |
| 4 | Result metadata | Every result row carries `$$meta`, built by the operations factory from `table(...).meta({ ... })` plus built-ins (`table`, `schema`). Used for result-type checks, for attaching `__typename`, and as the discriminator for Topic 2 unions/interfaces. |
| 5 | Composite primary keys | None expected. A table whose primary key is not exactly one guid column cannot be a node; `createClient` fails loudly. |
| 6 | Method names | `$findByGlobalId(id, options?)` and `$listByGlobalId(ids, options?)`. Helpers use the same vocabulary: `encodeGlobalId`, `decodeGlobalId`, `isGlobalId`, `GlobalIdError`. The column builder stays `guid()`. |
| 7 | `$$meta` scope | Defined here as a minimal contract (`{ key, table, schema?, globalId } & tableMeta`, `key` = alias = discriminant) because `$findByGlobalId` needs a discriminant; Topic 2 (polymorphic relations) owns the union select interface and any further meta fields, under the constraint that `$$meta.key` remains the discriminant. |

## Decision

**Option A — codec-wrapped `guid` columns + `$$meta` + `$findByGlobalId`, built G-first.** dsqlbase ships the primitives that every variant needs (runtime primary key, models map, `$$meta`, node registry, `$findByGlobalId`/`$listByGlobalId`) with raw ids first, then the codec that wraps ids and validates targets on every write and filter. The gqlbase changes (emit `guid()` and `.meta()` from the schema generator) are an external follow-up, not dsqlbase stories.

### Rejected options (one line each)

- **B. Table-level `node()` marker, raw rows, `wrap`/`unwrap` utilities, virtual `nodeId` field** — joined rows stay raw so `workspace.id` still needs wrapping in the application; a virtual field needs normalizer and type support that does not exist.
- **C. Client-level registry (`createClient({ nodes: { User: users } })`)** — same boundary burden as B; the typename mapping is repeated per `createClient` and invisible to the schema.
- **D. Store the global id in the database (text PK)** — loses the uuid type and index size, forces every key column to text, migrates every row, and bakes the table name into data that outlives renames.
- **E. Leave it to the application** — the request exists because it was forgotten in practice.
- **F. Generated middleware only, dsqlbase untouched** — see the amendment; a static shape map cannot type `Query.node` or unions, so it needs a runtime typename on rows, i.e. `$$meta`, i.e. Option G at minimum.

### Amendment: application-level wrapping compared on the real stack

Because gqlbase generates the declarations in every variant, "someone forgets to wrap" is not a differentiator. The decision is about *where the wrapping runs* and what each placement can validate.

**F — gqlbase-generated middy middleware, dsqlbase untouched.** gqlbase emits, per resolver, a shape map of its return type (`Workspace: { entity: "Entity", members: ["WorkspaceMember"] }`, connections and edges unwrapped) and an `after` middleware that walks the result and wraps every `id` with the typename from the map; a `before` middleware unwraps `ID` args and `ID` fields inside inputs; a generated `Query.node` resolver maps typename → table alias → `findOne`. Zero dsqlbase work, M in gqlbase. Holes: interface and union fields (`Query.node`, Topic 2) cannot be typed from a static map; a plain `ID` input field has no declared target, so it is unwrapped without a check; a wrong shape-map entry leaks raw ids silently; JWT claims written from rows stay raw while `viewer.workspace.id` is wrapped.

**G — dsqlbase primitives, generated middleware wraps.** dsqlbase ships `$$meta` (from generated `.meta({ __typename })`), `Table.primaryKey`, the node registry, `$findByGlobalId`/`$listByGlobalId`, `encodeGlobalId`/`decodeGlobalId`; ids stay raw inside the ORM. The generated `after` middleware wraps by `row.$$meta.__typename`, which is correct for interfaces and unions and for rows the resolver did not statically type. Inputs as in F. ~60% of A in dsqlbase, M in gqlbase. Forecloses wrong-table validation on writes and filters (a wrapped id reaching a `uuid` column fails as a Postgres syntax error) and leaves non-GraphQL consumers to wrap by hand.

**A on this stack.** The schema generator emits `guid("id")` for the primary key, `guid("<key>", "<targetTable>")` for every `@belongsTo` key (it already resolves `relation.key` and the target table), and `.meta({ __typename })` per model. Every `dsql` result is wrapped, existing `where: { id: args.id }` code keeps working (the codec unwraps), `$$meta.__typename` satisfies AppSync's interface/union requirement, and claims written from rows are wrapped consistently with what the client sees. Feature packages calling `dsql` directly receive wrapped ids too; raw SQL and cursor code must go through `column.param()`.

| | A — codec in dsqlbase | F — generated middleware only | G — `$$meta` + generated middleware |
|---|---|---|---|
| Output ids wrapped, nested included | automatic, every consumer | walker over static shape map; interfaces/unions need `__typename` set by hand | walker keyed on `$$meta.__typename`; interfaces/unions correct |
| Input ids unwrapped | automatic (codec) + target check on key columns and PK | generated `before` middleware; target check only where the schema declares one | as F; `decodeGlobalId(id, type)` for explicit checks |
| Wrong-table id detected | on every write and filter | no | on `decodeGlobalId` / `$findByGlobalId` only |
| Works outside GraphQL (claims, events, jobs) | yes | no | wrap by hand |
| `node(id)` | `$findByGlobalId`, one line | generated typename→table map + `findOne` | `$findByGlobalId`, one line |
| dsqlbase stays GraphQL-agnostic | `.meta()` and `guid` are generic | fully | `.meta()` is generic |
| Prerequisite: codec-aware `where` | yes (a listed gap regardless) | no | no |
| Raw SQL / cursors / claims | must unwrap (`column.param`) | plain | plain |
| dsqlbase effort | M–L (6 stories) | 0 | M (4 stories) |
| gqlbase effort | S (emit `guid` / `.meta`) | M (walker, shape maps, arg unwrapper, node) | M (walker, arg unwrapper) |

**Why A as the end state.** Two things generated middleware cannot provide: target validation on every write and filter (a `@belongsTo` key column knows its table; an `ID` input field does not), and one id representation across GraphQL, JWT claims, events, logs and tests. The where-clause codec fix is owed regardless. **Why G-first.** A and G share four of A's six stories; ordering them first leaves a stop-or-continue decision after `$findByGlobalId` ships with nothing wasted.

## Design variants inside A (chosen first, rejected after)

**A1. Key for relation-key columns.** *Explicit string key* `guid("workspace_id", "workspaces")` — chosen: local, no import cycle, works without a relation, typos caught at `createClient` (key must resolve to a node table). *Thunk reference* — rejected (composite-key ambiguity, cycles). *Infer from relations* — rejected as the mechanism (a column's wire format would depend on a relation declared elsewhere; keys without relations would stay raw), kept as validation. *Raw key columns* — rejected (`user.workspaceId !== user.workspace.id`). **Amended by Topic 2** (`schema-polymorphic-relations.md`): a keyless `guid()` column that is the `from` of a `belongsTo(union, { discriminator })` relation is bound to a *dynamic* key read from the discriminator column instead of the own-table default; an explicit static key together with a discriminator throws at `createClient`. This is the one case where a relation decides a column's key, because the key is per row and the relation is the only place that names the discriminator.

**A2. Where the codec is bound to a table.** *Core marker + `Column` composes* — chosen. `ColumnConfig` gains `guid?: { key?: string }` (like `identity` and `generated`: core owns the concept, `dsqlbase` owns the builder). `Column` binds `key = config.guid.key ?? table.alias` and wraps the base codec (the pk field of the target is bound by the registry once all tables exist; for a dynamic key the registry binds `{ column }` and the wrapping moves to the row-aware resolver hook, see Topic 2); `SchemaRegistry` can validate `column.guidKey` without importing `dsqlbase` (dependency direction, `docs/internals/architecture.md`). *Overridable `ColumnDefinition._bindCodec(table)`* — hides the marker in a subclass so the registry cannot validate it. *Codec `decode(raw, ctx)` extra parameter* — pushes table context into every codec call site.

**A3. Codec-aware where (prerequisite).** *Normalizer builds `SQLParam(value, column.codec.encode)` through a new `Column.param(value)`* — chosen. `eq/neq/gt/gte/lt/lte/in/between` and the value shorthand encode; `beginsWith/endsWith/contains` stay raw patterns (documented). `Column.param()` also serves `$query` users: ``sql`${users.columns.id} = ${users.columns.id.param(id)}` ``. *Make `sql.eq` detect a `Column` on the left* — couples `core/sql` to `core/runtime`; rejected. Behaviour change to flag: date, bigint and interval filters now send codec-encoded values instead of driver-serialized JS values; e2e filter tests must cover each.

**A4. Payload format** (internal to `encodeGlobalId`/`decodeGlobalId`, swappable). *`guid:` + base64url(JSON `[tableKey, { [pkField]: value }]`)* — chosen. The prefix makes raw-vs-wrapped detection exact (a uuid never starts with `guid:`); base64url is URL-safe; the object form names the key field(s) instead of assuming `id`, and represents composite keys (`{ teamId, userId }`). Keys are **aliases**, not DB names: the table key is the schema alias and the pk fields are field aliases — exactly what `dsql[key].findOne({ where: pk })` takes, so no name→alias mapping is needed, and what gqlbase derives from GraphQL typenames, so ids follow the client-visible identity rather than the physical one (a DB rename does not invalidate ids; a type rename does, which is right). Aliases are unique within a schema object, so namespaces need no composite key. The ORM never trusts the payload: `decodeGlobalId` is followed by a registry check that the fields equal the node table's primary key (`GlobalIdError("key_mismatch")` otherwise). *DB names as keys* — rejected: needs a reverse map to reach the model client and ties ids to physical names. *`guid:` + base64url(`<key>:<uuid>`)* — shorter, but assumes a single `id` column. *`guid:` + base64(JSON `[uuid, key]`)* (the `improvements.md` sketch) — same assumption. *Bare base64* — no prefix, so "already wrapped?" becomes a heuristic. *Readable `key_uuid`* — leaks table names. Re-keying the schema object or renaming a primary-key field changes every id in the wild unless the self column pins the old key (`guid("id", "users")`); the explicit key therefore doubles as a stable label and can carry the GraphQL typename if wanted.

Composite keys and the payload: a column codec wraps one column's value, so a composite global id can only be produced by the result resolver, which has the table, its primary key and the whole row. It is exposed as `$$meta.globalId` on every node row (single-column nodes get the same value there as in their wrapped `id`). A `guid(column, key)` reference column can only target a single-column node; targeting a composite node throws at `createClient`. `$findByGlobalId` handles both shapes: it builds `where` from the decoded object over the registry's primary key.

**A5. `$$meta` shape.** *Enumerable, frozen, typed property* — chosen: survives spread and JSON; a column alias named `$$meta` is rejected when the `Table` is built. Contract fixed by this proposal: `$$meta = { key, table, schema?, globalId } & tableMeta` — `key` is the schema alias and the discriminant, `table` the DB name; `key`/`table`/`schema`/`tableMeta` are shared per table, `globalId` is computed per row from the primary key. Topic 2 owns everything beyond this (union select interface, further fields) and must keep `$$meta.key` as the discriminant. *Non-enumerable* — lost on `{ ...row }`, which resolvers do. *Symbol key* — invisible to JSON and tooling. *Spread user meta onto the row (`row.__typename`)* — collides with the column namespace; the application does `{ ...row, __typename: row.$$meta.__typename }` or reads `$$meta` where a typename is required.

**A6. Retrieval surface.** *`$findByGlobalId(id, options?)` + `$listByGlobalId(ids, options?)` + `encodeGlobalId`/`decodeGlobalId` exports* — chosen. Options keyed by alias (`{ users: { select, join }, workspaces: true }`) — exactly Topic 2's `on` map (`OnSelectionOf`), so `$findByGlobalId(id, on)` and a union join's `on:` are one type; result is a union narrowed by `$$meta.key`; `$listByGlobalId` groups by key, runs one query per table (`in` for single-column keys, `or` of `and` groups for composite), preserves input order and returns `null` for misses (batch-resolver shape). *Handle only* (`$findByGlobalId(id)` → `{ model, pk }`) — pushes the lookup to the application; `decodeGlobalId` + `dsql[alias]` already covers it. *Per-model `findByGuid`* — redundant once where is codec-aware: `dsql.users.findOne({ where: { id } })` unwraps and rejects a wrong-table id.

**A7. Guid `valueType`.** *`string`* — chosen; wrapped and raw are both strings. *Branded `Guid<Key>`* — deferred: plain `string` inputs are not assignable to a branded type, so it needs separate input and output types on `ColumnConfig`. Follow-up.

**A8. Strictness on input.** Lenient (raw uuid accepted; a wrapped id must match the column key or throw), per `improvements.md`. A `strict` client option that rejects raw ids is a one-line follow-up.

## API

### Schema side

```ts
import { guid, table, text, relations, belongsTo } from "dsqlbase/schema";

export const workspaces = table("workspaces", {
  id: guid("id").primaryKey().defaultRandom(),               // key = "workspaces" (the alias below)
  displayName: text("display_name").notNull(),
}).meta({ __typename: "Workspace" });

export const users = table("users", {
  id: guid("id").primaryKey().defaultRandom(),               // key = "users"
  workspaceId: guid("workspace_id", "workspaces").notNull(), // key = alias of the target table
  parentId: guid("parent_id"),                               // non-PK, no key → own table (self reference)
  name: text("name").notNull(),
}).meta({ __typename: "User" });

export const userRelations = relations(users, {
  workspace: belongsTo(workspaces, { from: [users.columns.workspaceId], to: [workspaces.columns.id] }),
});

// createClient({ schema: { users, workspaces, userRelations }, session }) — the object keys are the aliases
```

Rules enforced when `SchemaRegistry` is built (`createClient`):

- A table is a **node** iff its primary key is exactly one column and that column is a guid column. Its key is the table's schema alias unless the column overrides it.
- Every guid column's key must resolve to a node table's key. Duplicate node keys throw.
- For every relation pair `from[i]` / `to[i]`: same `dataType`; if either side is a guid column, both are, with equal keys. Errors name `table.column` on both sides.
- `$$meta` is reserved as a field alias.

### Client side

```ts
const user = await dsql.users.findOne({
  where: { id: { eq: idFromClient } },                    // wrapped or raw; wrong table throws GlobalIdError
  join: { workspace: { select: { id: true, displayName: true } } },
});
user.id                                                  // "guid:..." (users)
user.workspace?.id                                       // "guid:..." (workspaces)
user.workspaceId === user.workspace?.id                  // true
user.$$meta                                              // { key: "users", table: "users", globalId: "guid:...", __typename: "User" }
user.workspace?.$$meta                                   // { key: "workspaces", table: "workspaces", globalId: "guid:...", __typename: "Workspace" }

const record = await dsql.$findByGlobalId(id, { users: { select: { id: true, name: true } }, workspaces: true });
if (record?.$$meta.key === "users") record.name;         // narrowed on the alias
const many = await dsql.$listByGlobalId(ids);            // same order as `ids`, null for misses
decodeGlobalId(id);                                      // { key: "users", pk: { id: "<uuid>" } }
encodeGlobalId("users", { id: "<uuid>" });
user.$$meta.globalId === user.id;                        // true for single-column nodes
```

`$findByGlobalId` and `$listByGlobalId` live on `BaseClient`, so they are available inside `$transaction`. They go through `ModelClient.findOne` / `findMany`, so the predicate-injection seam chosen in the client topic (`_validateWhereExpression` in `packages/core/src/runtime/operation.ts`) applies to node lookups automatically. A `node(id)` lookup that bypassed tenancy would be a cross-tenant read; the proposal makes it structurally impossible by never issuing SQL outside the model client.

## Runtime design

| File | Change |
|---|---|
| `packages/core/src/runtime/global-id.ts` (new) | `encodeGlobalId(key, pk)`, `decodeGlobalId(value, expectedKey?)` → `{ key, pk }` (wrapped must match `expectedKey` when given; raw uuids are passed through by the codec, not by this function), `isGlobalId(value)`, `GlobalIdError` with `code: "format" \| "key_mismatch" \| "unknown_node"`. |
| `packages/core/src/definition/column.ts` | `ColumnConfig.guid?: { key?: string }`; when set, the definition-level codec becomes `{ encode: unwrap-without-key-check, decode: identity }` so `default()` keeps working before binding. The marker is **not** serialized by `toJSON`. |
| `packages/core/src/runtime/column.ts` | `readonly guidKey?: string`, `readonly dataType: string`, `param(value): SQLParam`. `Column` also learns its field alias (the key in the `columns` object). `guidKey` is `string` (static) or `{ column: AnyColumn }` (dynamic, bound from a Topic 2 discriminator; codec stays identity and the resolver hook wraps). When `guid` is set with a static key the codec is bound in two phases: the constructor binds the key (`config.guid.key ?? table.alias`); the registry, once every table exists, binds the target node's primary-key field alias (`bindGlobalIdTarget(pkField)`) so `decode = encodeGlobalId(key, { [pkField]: base.decode(r) })` and `encode = base.encode(isGlobalId(v) ? decodeGlobalId(v, key).pk[pkField] : v)`. |
| `packages/core/src/runtime/table.ts` | `readonly alias: string` (passed by the registry from the definition-object key; defaults to `name` when a `Table` is built directly); `readonly primaryKey: AnyColumn[]` built from column-level flags plus `PrimaryKeyConstraintDefinition` entries read from `definition["_constraints"]` (the pattern already used for `_namespace`); `readonly meta` — frozen `{ key: alias, table: name, schema?, ...definition.meta }` (the shared part); throws when a field alias equals `$$meta`. |
| `packages/core/src/definition/table.ts` | `meta<M extends object>(meta: M)`; `TableConfig.meta?`; excluded from `toJSON`. |
| `packages/core/src/runtime/registry.ts` | Node registry built after tables, keyed by alias: `getNodeTable(key)` (table, primary-key columns), `getNodeTables()`; `_buildTables` passes the alias into `new Table(def, relations, alias)`; binds each guid column's target primary-key field; validation of guid keys, duplicate node keys, reference columns targeting composite nodes, and relation pairs in `_buildRelations`. |
| `packages/core/src/runtime/operation.ts` | Nested `FieldResolver` branch becomes `{ meta, fields }`; `_resolveSelectParams` and `_resolveJoinEntries` supply the level's table; `_createResultResolver` writes `$$meta` on every row at every level (top-level, join, `return`): the shared `{ key, table, schema?, ...meta }` plus a per-row `globalId` computed from the level's primary-key columns via `encodeGlobalId` (absent when the table is not a node). |
| `packages/dsqlbase/src/schema/columns/guid.ts` (new) | `guid(name, key?)` → `UUIDColumnDefinition` with `dataType: "uuid"`, `guid: { key }`; exported from `packages/dsqlbase/src/schema/index.ts`. |
| `packages/dsqlbase/src/client/model/normalizer.ts` | Where values through `column.param(...)` for `eq/neq/gt/gte/lt/lte/in/between` and the value shorthand. |
| `packages/dsqlbase/src/client/database/base.ts` | `_models` map keyed by alias; `$findByGlobalId` (decode → registry → `where` over the primary key → `findOne` with the alias's options), `$listByGlobalId`. New `attachModels(client, ctx)` shared by `packages/dsqlbase/src/client/create.ts` and `packages/dsqlbase/src/client/transaction/transaction-client.ts`. |
| `packages/dsqlbase/src/index.ts`, `packages/dsqlbase/src/client/index.ts` | Export `encodeGlobalId`, `decodeGlobalId`, `isGlobalId`, `GlobalIdError`. |

SQL is unchanged: joins compare raw columns (`sql.eq(toColumn, fromColumn)`), the wrapped form never reaches Postgres.

## Type design

- `TableDefinition<TName, TColumns, TNamespace, TMeta = {}>` and `Table<TName, TColumns, TNamespace, TRelations, TMeta>`; every `TableDefinition<infer …>` site in `packages/core/src/runtime/registry.ts` and `packages/dsqlbase/src/client/model/base.ts` gains the fourth inference. `.meta()` returns the definition re-typed with `TMeta`.
- `RecordMetaOf<TTable> = { key: TAlias; table: TName; schema?: string; globalId: string } & TMeta` (`globalId` absent on non-node tables). `TAlias` is the key of the table in the definition object, already available as `keyof TSchema["tables"]` in `RuntimeTables` (`packages/core/src/runtime/registry.ts`). `QueryResultOf`, `RelationJoinResultOf` and `ReturningResultOf` (`packages/dsqlbase/src/client/model/base.ts`) add `$$meta: RecordMetaOf<…>`.
- The guid column config brands `__type: { guid: true }`. `NodeAliasesOf<S>` = aliases whose sole primary-key column carries the brand; `GlobalIdOptionsOf<S>` = `OnSelectionOf<NodeTablesOf<S>, S>` — the `on` map type defined in `schema-polymorphic-relations.md` (`{ [alias]?: Pick<QueryArgs, "select" | "where" | "join"> | boolean }`; `false` excludes a node type from the lookup); `GlobalIdResultOf<S, Opts>` = union over node aliases of `QueryResultOf` with the per-alias options applied, `| null`.
- Guid `valueType` stays `string`.
- Type tests in `packages/dsqlbase/src/client/model/client.types.test.ts` plus a new `global-id.types.test.ts`.

## Migration impact

None. `guid()` serializes exactly as `uuid()` (`dataType: "uuid"`); the guid marker and table meta are excluded from `toJSON`, so migration snapshots, introspection diffs and validation rules are unchanged. Switching an existing column from `uuid` to `guid` is a no-op migration. No DSQL capability is involved.

## Failure modes

| Input | Behaviour |
|---|---|
| Malformed `guid:` string | `GlobalIdError("format")` on encode or `$findByGlobalId` |
| Wrapped id whose key ≠ column key, or whose payload fields ≠ the node's primary key | `GlobalIdError("key_mismatch")` — the wrong-table safety net |
| Raw uuid to a guid column | accepted (lenient) |
| `$findByGlobalId` with a key that is not a node table | `GlobalIdError("unknown_node")`; a missing row returns `null` |
| Composite PK with a guid self column; reference column targeting a composite node; guid key unresolved; relation pair mismatch; `$$meta` alias | throws at `createClient` |
| `$query` raw SQL with a wrapped id | not unwrapped — use `column.param(v)` or `decodeGlobalId` (documented) |
| Pattern filters on guid columns | unchanged; uuid columns do not support `LIKE` regardless |

## Stories, ordering, changesets

All changesets are `minor` on the fixed group. Ordered G-first; each story names its docs pages and is not done until they are updated in the same PR. **Stories 1, 2, 3 and 5 below are implemented by `.claude/proposals/schema-prerequisites.md` (its stories 1, 2, 5, 7) together with the join-aliasing and composite-pair gap fixes; they are kept here for the reasoning and are not to be re-planned.**

1. **Runtime primary key** (prerequisite). `Table.primaryKey` from column flags and table-level constraint. Docs: `docs/internals/runtime-pipeline.md` (Primary keys at runtime, gap table).
2. **Shared model attachment and alias on `Table`** (prerequisite). `attachModels`, `Table.alias` passed from the registry, `_models` on `BaseClient` keyed by alias (Topic 2 attaches `UnionClient`s through the same function). Docs: `docs/internals/runtime-pipeline.md` (derived-client pattern).
3. **`$$meta` and `table().meta()`** (contract shared with Topic 2; implement after the polymorphic-relations proposal is accepted so the union select interface is settled). Resolver tree shape with per-level table context and a **row-aware post-processing hook** (computes `globalId` from the primary key here; Topic 2 uses the same hook for union dispatch and dynamic-key wrapping), per-row `globalId`, types. Additive to result types but can break consumer `toEqual` assertions — stated in the changeset. Docs: `docs/guide/querying.md`, `docs/guide/schema.md`, `docs/internals/runtime-pipeline.md`.
4. **Node registry, `guid()` as a marker (no codec), `$findByGlobalId` / `$listByGlobalId`, `encodeGlobalId` / `decodeGlobalId` exports.** Column values are raw at this point but `$$meta.globalId` is present on every node row; Option G is complete. Docs: new `docs/guide/global-ids.md`, `docs/guide/schema.md`, `docs/guide/transactions.md`, `docs/internals/architecture.md`.
   — *Decision point: stop at G (gqlbase generates the walker) or continue.* —
5. **Codec-aware where** (prerequisite for 6 and a listed gap in its own right). `Column.param`, normalizer, e2e filter tests for date, bigint, interval. Docs: `docs/internals/codec-boundary.md` (move where-values from "does not apply" to "applies"), `docs/internals/runtime-pipeline.md` gap table, `docs/guide/querying.md`.
6. **Guid codec and relation validation** (turns G into A). Bound wrap/unwrap on `Column`, key check on encode, relation pair validation, e2e for wrapped ids everywhere. Docs: `docs/guide/global-ids.md`, `docs/guide/relations.md`, `docs/internals/codec-boundary.md`.

External follow-up (gqlbase repository, not a dsqlbase story): `DsqlBaseSchemaGeneratorPlugin` emits `guid("id")`, `guid("<key>", "<targetTable>")` for `@belongsTo` keys, and `.meta({ __typename })` per model (Option A); or a generated `after`/`before` middleware pair keyed on `$$meta.__typename` (Option G).

### Breaking surface

- `FieldResolver` nested branch changes shape (exported type; internal use).
- `TableDefinition` and `Table` gain a trailing generic with a default (source-compatible for callers relying on inference).
- Result rows gain `$$meta`.
- Where-clause wire format changes for columns with non-identity codecs (date, bigint, interval, guid).

Level: `minor`, with each of the four called out in the changeset body and a `Docs:` line per story.

## Test plan

- **core unit** (`packages/core/src`): `global-id.test.ts` round-trip of single and composite payloads, format errors, key and field mismatch; `column.test.ts` bound codec with alias key and explicit key, `param()`; `table.test.ts` `primaryKey` from flag, from constraint, composite, reserved `$$meta` alias; `registry.test.ts` node registry, duplicate keys, unresolved key, relation pair mismatch; `operation.test.ts` `$$meta` at every level, shared part frozen, `globalId` per row including composite keys.
- **dsqlbase unit** (`packages/dsqlbase/src`): `guid()` serializes identically to `uuid()`; normalizer encodes each operator and the shorthand and leaves pattern operators raw; type tests for `$$meta` on `QueryResultOf` / `ReturningResultOf`, `GlobalIdResultOf` narrowing by `$$meta.key`, `GlobalIdOptionsOf` per-alias select.
- **e2e, PGlite** (`packages/tests/src/specs`): extend `db/schema/schema.ts` with guid primary keys, a keyed relation column and `.meta()`; new `global-id.spec.ts` covering wrapped ids in `findOne`/`findMany`/`create` with `return`/`update`/`delete`; joined rows wrapped with their own key; `workspaceId === workspace.id`; filter by wrapped and by raw; wrong-table id throws; namespaced table key is its alias; `$findByGlobalId` per table including alias ≠ table name (`members` / `team_members`, key is `members`) and a composite-key table through `$$meta.globalId`; `$listByGlobalId` order and misses; namespaced table key; `$$meta.__typename` on nested rows; date/bigint/interval filters after the where fix. Failing tests that expose real bugs stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): new `global-ids.md` (guid columns, keys, payload shape, `$$meta` contract, `$findByGlobalId`/`$listByGlobalId`, helpers, lenient input, composite-key rules, the raw-SQL caveat); `schema.md` (`guid()`, `table().meta()`); `relations.md` (guid/uuid pair validation rule); `querying.md` (`$$meta` on results, codec-aware where, `column.param`); `transactions.md` (`$findByGlobalId` on the transaction client).
- **Internals** (`docs/internals/`): `codec-boundary.md` (where values now encoded; binding happens on `Column`); `runtime-pipeline.md` (gaps closed: codec where, primary key exposure, models map and shared attachment; resolver tree shape; `$$meta`); `architecture.md` (`packages/core/src/runtime/global-id.ts`, `packages/dsqlbase/src/schema/columns/guid.ts`).
- **Decision record**: `docs/decisions/0003-global-ids.md` on acceptance; this proposal is then deleted.
- **Stale lines**: root `README.md` showcase (add a guid example); `packages/dsqlbase/README.md` quickstart.
- **Cross-topic notes to carry forward**: `$$meta.key` is the discriminator for Topic 2 unions and interfaces; `$findByGlobalId` / `$listByGlobalId` take Topic 2's `OnSelectionOf` map; Topic 2 adds the dynamic guid key and the row-aware resolver hook (both amendments recorded inline above); two listed gaps (table aliasing in lateral joins, composite relation pairs) are prerequisites shared by both topics and tracked in a separate prerequisites proposal; cursor tokens (client pagination topic) must encode guid values through the column codec; `$findByGlobalId` inherits tenancy predicates from the seam chosen in the client tenancy topic.
