---
proposal: schema-polymorphic-relations
status: draft
owner: silviu
created: 2026-09-20
---

# Polymorphic relations (`union()`), the `on` selection, and discriminator filtering

Prime: `.claude/prime/02-schema.md` Topic 2. Review context: `.claude/prime/00-review.md`, `docs/internals/runtime-pipeline.md`. Depends on `.claude/proposals/schema-guid.md` (`$$meta`, global ids, `Table.alias`).

## Problem

The API layer exposes GraphQL interfaces and unions, and relations to them: a feed that mixes rows from several tables, a reference whose target is one of several tables, and top-level queries over an interface. dsqlbase relations target exactly one table, so today none of these can be declared, joined, ordered, or paginated through the client.

Vocabulary used here, mapped to GraphQL because that is where the requirement comes from:

| GraphQL | dsqlbase (this proposal) |
|---|---|
| `union Post = Photo \| Video` | `union({ photos, videos })` — a set of member tables keyed by schema alias |
| `interface Partner { name }` | the same `union()`; the interface's fields are a subset of the members' **shared fields** (the intersection of member field aliases with equal `dataType`) |
| `... on Photo { photoUrl }` | `on: { photos: { select: { photoUrl: true } } }` |
| `__typename` / `__resolveType` | `$$meta.key` (the member alias) and `$$meta.__typename` from `table().meta()` |
| `feed(type: VIDEO)` | `where: { $$key: { eq: "videos" } }` |

### Consumer stack (verified 2026-09-20 from the repositories)

- gqlbase `RelationsPlugin` (`packages/plugins/src/base/RelationsPlugin/RelationsPlugin.ts`) already accepts union and interface targets for `@hasMany` / `@hasOne` / `@belongsTo`: `_setRelationKey` adds the key field to every member of a union target and `_getKeyTypeName` falls back to `ID` when member id types differ. The GraphQL side is ready.
- gqlbase `DsqlBaseSchemaGeneratorPlugin._generateRelations` throws `Relation field "…" must reference a model object type` for those targets. That is the gap this proposal closes at the ORM; the generator change is an external follow-up.
- The reference application uses polymorphism in both directions: polymorphic belongs-to (`LedgerEntry.counterparty: TradingEntity`, `settlement: Settlement` with `union Settlement = Transaction | Receipt`, `Invoice.issuer / recipient: TradingEntity @hasOne(key: { ref: "issuerId" })`), has-many to an interface (`ArchiveFolder.entries: [ArchiveEntry!]`, where `ArchiveFolder implements ArchiveEntry` — a self-referential member), and a top-level query over an interface (`Viewer.partners: Partner @hasMany`; `Viewer` is not a model). Belongs-to is the common direction. The reference application is the reference, not the boundary: every polymorphic query and join is in scope.

### What the code does today (verified)

- `FieldRelation = { target: one TableDefinition, type, from[], to[] }` (`packages/core/src/definition/relations.ts`). `RelationsDefinition.toJSON` serializes `target.name`; the migration module ignores relations.
- `OperationsFactory._resolveJoinEntries` (`packages/core/src/runtime/operation.ts`) uses `from[0]` / `to[0]` only, resolves one target table through `SchemaRegistry.getRelationTarget`, builds one `SelectParams` and one resolver list per relation. `_resolveFields` accepts real columns only, so no literal (a discriminator) can be selected.
- `QueryBuilder._buildLateralJoin` (`packages/core/src/runtime/query.ts`) emits `LEFT JOIN LATERAL (SELECT row_to_json("__t".*) | COALESCE(json_agg(row_to_json("__t".*)), '[]') AS "data" FROM (<buildSelectQuery>) AS "__t") … ON true`. Inner tables are referenced by raw name, so a self-referential member collides with its parent (listed gap "No table aliasing in joins").
- `_createResultResolver` walks `FieldResolver = [field, AnyColumn | FieldResolver[]]` with one resolver list per level; there is no per-row dispatch.
- `SchemaRegistry` (`packages/core/src/runtime/registry.ts`) registers `TableDefinition` and `RelationsDefinition` only; `Kind` (`packages/core/src/definition/base.ts`) has no union kind.
- Types (`packages/dsqlbase/src/client/model/base.ts`): `RelationTargetOf` resolves to one `TableDefinition`; `RelationQueryOf`, `RelationJoinResultOf` and `QueryResultOf` infer a single target.
- `sql` (`packages/core/src/sql/tag.ts`) has no `UNION` helper; `sql.join(branches, " UNION ALL ")` composes one.
- DSQL (`docs/internals/dsql-capabilities.md`): `UNION ALL`, lateral joins and `json_agg` are plain SQL already in use; views are supported but `ViewDefinition` is a stub; inherited tables are unsupported; foreign keys are allowed at DDL level (the module refuses them — stale).

## Decisions taken during grilling

| # | Question | Decision |
|---|---|---|
| 1 | Scope | Every polymorphic query and join: has-many and has-one to a union, polymorphic belongs-to, and a top-level read-only union client. |
| 2 | Polymorphic belongs-to storage | The **relation owns the discriminator**: `belongsTo(union, { from, to, discriminator: source.columns.<column> })`. The `from` column is a keyless `guid()`; at runtime its key is read from, and written to, the discriminator column. A key column on `guid()` itself was rejected: a relation concern inside a column definition. |
| 3 | Shared fields | Not declared. The registry computes the **intersection** of member field aliases with equal `dataType`; it is what relation keys, cross-member `where` / `orderBy`, and the interface-style `select` can use. A GraphQL interface's fields are a subset of it (gqlbase validates that); a GraphQL union uses only `on`. |
| 4 | Query shape | GraphQL vocabulary: shared-level `select` / `where` / `orderBy` / `limit` / `offset` over shared fields, plus **`on: { [memberAlias]: { select, where, join } \| boolean }`** per member. The `on` map is the same type `$findByGlobalId` / `$listByGlobalId` take. |
| 5 | Pagination over a union | Offset is the outer `LIMIT` / `OFFSET`. Keyset is shared order values + `$$meta.key` + primary key, applied per branch; the union appends `$$key` and the primary key as tiebreakers. The client pagination topic builds on this SQL shape. |
| 6 | Discriminator filtering | Both forms: static `on: { videos: false }`, and a **`$$key` pseudo-field** in the shared `where` / `orderBy`, evaluated at build time into branch pruning. |
| 7 | Base table + child tables instead? | No, as the ORM mechanism — a row would have two node identities. Available by hand with single-target relations; needs nothing from dsqlbase. |
| 8 | Registered schema node? | Yes: `Kind.UNION`, listed in `createClient({ schema })`, read-only client `dsql.<alias>.findOne / findMany`. `$$meta.key` on a union row is always the member's alias, never the union's. |

## Decision

**Option A — a `union()` definition node consumed by `hasMany` / `hasOne` / `belongsTo` and by a read-only union client; one `UNION ALL` builder behind all of them.** Each member becomes a branch that selects its own columns plus a `$$key` literal; the branches are combined with `UNION ALL`, ordered and limited across members in SQL, and aggregated into JSON exactly like today's lateral joins. The result resolver dispatches every row by `$$key` to the member's resolver tree and stamps the member's `$$meta`. Polymorphic belongs-to stores a `(discriminator, id)` pair, which is exactly a decoded global id, so the Topic 1 invariant `entry.counterpartyId === entry.counterparty.id` holds.

### Rejected options (one line each)

- **B. Base table + typed child tables** (schema-level polymorphism; relations stay single-target; interface = base table) — every row gets two node identities (`partners` and `companies`), incompatible with one key per row from Topic 1; every write is two tables and every read a join; no per-member shape without a second join level. Remains available by hand.
- **C. N single-target relations + a JS merge helper** — works today, but no cross-member `LIMIT` / `OFFSET` in SQL (each branch over-fetches), keyset pagination across members is impossible, and polymorphic belongs-to has no expression at all. Kept as the baseline.
- **D. Database view over `UNION ALL` as a single-target relation** — `ViewDefinition` is a stub and the migration module would have to own view DDL; per-member columns must be NULL-padded so the per-member shape is lost; the per-branch resolver and types are needed anyway; a self-referential view hits the same aliasing gap.
- **E2. Column-owned key column** `guid(name, { keyColumn })` — a relation concern inside a column definition.
- **E3. One nullable key column per member** (exclusive arc, FK-able) — wider tables, needs a virtual field to present one `counterpartyId`; achievable today with single-target relations.
- **E4. No discriminator, probe every member by id** — N index probes per row, `counterpartyId` cannot be wrapped on read, writes cannot be validated.
- **F2. Declared shared-field list on `union()`** — redundant with the intersection; the interface field list is gqlbase's to validate.

### Comparison

| | A `union()` + `UNION ALL` | B base + children | C N relations + JS | D view |
|---|---|---|---|---|
| Cross-member `ORDER BY` / `LIMIT` in SQL | yes | yes (base) | no | yes |
| Per-member shape (`on`) | yes | second join level | yes | no (padded) |
| Polymorphic belongs-to | yes | yes (single-target) | no | yes |
| Keyset pagination across members | yes | yes | no | yes |
| Node identity per row | one (member) | two | one | one |
| Migration impact | none | user-managed tables | none | view DDL (stub) |
| Prerequisites from the gap table | join aliasing, composite pairs, codec-aware where | none | none | view support |
| Effort | L | 0 | S | L+ |
| Forecloses | FK on the polymorphic belongs-to column | Topic 1 node model | SQL pagination | per-member shape |

## API

### Schema side

```ts
import { union, table, guid, text, datetime, relations, hasMany, belongsTo } from "dsqlbase/schema";

export const photos = table("photos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id", "users").notNull(),
  photoUrl: text("photo_url").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
}).meta({ __typename: "Photo" });

export const videos = table("videos", {
  id: guid("id").primaryKey().defaultRandom(),
  userId: guid("user_id", "users").notNull(),
  videoUrl: text("video_url").notNull(),
  createdAt: datetime("created_at").notNull().defaultNow(),
}).meta({ __typename: "Video" });

// Members are keyed by their schema alias; the registry rejects any other key.
export const posts = union({ photos, videos });
// posts.columns is the intersection: { id, userId, createdAt }

export const userRelations = relations(users, {
  feed: hasMany(posts, { from: [users.columns.id], to: [posts.columns.userId] }),
  // Members whose key aliases differ: to: { photos: [photos.columns.ownerId], videos: [videos.columns.userId] }
});

// Polymorphic belongs-to: the relation owns the discriminator.
export const tradingEntities = union({ companies, persons });

export const ledgerEntries = table("ledger_entries", {
  id: guid("id").primaryKey().defaultRandom(),
  counterpartyType: text("counterparty_type"),   // holds a member alias ("companies"); may be $enum-constrained
  counterpartyId: guid("counterparty_id"),       // no static key: the relation below binds a per-row key
  amount: numeric("amount").notNull(),
});

export const ledgerEntryRelations = relations(ledgerEntries, {
  counterparty: belongsTo(tradingEntities, {
    from: [ledgerEntries.columns.counterpartyId],
    to: [tradingEntities.columns.id],
    discriminator: ledgerEntries.columns.counterpartyType,
  }),
});

// createClient({ schema: { users, photos, videos, posts, companies, persons, tradingEntities, ledgerEntries, userRelations, ledgerEntryRelations }, session })
```

Rules enforced when `SchemaRegistry` is built (`createClient`):

- Every key of the `union()` object equals the member's schema alias; every member is a registered table; a union has at least one member; a union cannot be a member of a union.
- Shared fields are the aliases present on every member whose `dataType` matches on all of them. Relation `to` columns taken from `union.columns` must be shared; a per-member `to` map must name one column list per member.
- `belongsTo(union)` requires `discriminator`; the discriminator column belongs to the source table and is text-like (`text`, `varchar`, or a text domain); the `from` column is a `guid()` without a static key (or a plain `uuid()`, in which case the id is stored and returned raw and only the join works). A static key together with `discriminator` throws.
- `hasMany(union)` / `hasOne(union)` take no discriminator: the key lives on the members.
- `$$key` and `$$meta` are reserved field aliases on every table.

### Client side

```ts
// has-many to a union
const user = await dsql.users.findOne({
  where: { id },
  join: {
    feed: {
      select: { id: true, createdAt: true },              // shared fields
      where: { createdAt: { gt: since } },                 // shared fields; applied inside every branch
      orderBy: { createdAt: "desc" },                      // ORDER BY on the UNION ALL
      limit: 20,
      on: { photos: { select: { photoUrl: true } }, videos: false },   // fragment-style; false excludes the branch
    },
  },
});
for (const post of user.feed) {
  if (post.$$meta.key === "photos") post.photoUrl;        // narrowed on the member alias
}

// discriminator filtering from a resolver argument
await dsql.users.findOne({ where: { id }, join: { feed: { where: { $$key: { in: types } }, orderBy: { createdAt: "desc" } } } });

// polymorphic belongs-to
const entry = await dsql.ledgerEntries.findOne({
  where: { id },
  join: { counterparty: { on: { companies: { select: { id: true, name: true } }, persons: true } } },
});
entry.counterpartyId === entry.counterparty?.id;         // true — wrapped with the key read from counterpartyType
await dsql.ledgerEntries.create({ data: { counterpartyId: companyGlobalId, amount: 10 } });   // counterpartyType filled from the id's key
await dsql.ledgerEntries.findMany({ where: { counterpartyId: { eq: companyGlobalId } } });    // counterparty_type = 'companies' AND counterparty_id = $1
await dsql.ledgerEntries.findMany({ where: { counterpartyType: { eq: "companies" } } });      // plain column filter

// top-level union query (read-only)
const partners = await dsql.tradingEntities.findMany({
  where: { companyId: { eq: companyId } },
  orderBy: { name: "asc" },
  limit: 20,
  on: { companies: { join: { members: true } } },
});

// the same `on` map on the global-id lookups (Topic 1)
const record = await dsql.$findByGlobalId(id, { users: { select: { name: true } }, workspaces: true });
```

Semantics of `on`: omitted → every member, all of its columns (or the shared `select` when given); `alias: true` → included with the shared `select`; `alias: { select, where, join }` → the member's selection is the shared `select` ∪ the member `select`, the member `where` is `AND`-ed with the shared `where` inside that branch, and `join` uses the member's own relations; `alias: false` → no branch. `distinct` is not accepted on a union.

### SQL

Has-many (has-one and belongs-to use `row_to_json` + `LIMIT 1`; belongs-to adds `AND "ledger_entries"."counterparty_type" = 'companies'` to each branch):

```sql
LEFT JOIN LATERAL (
  SELECT COALESCE(json_agg("__u"."data" ORDER BY "__u"."__o0" DESC, "__u"."__k" ASC, "__u"."__pk0" ASC), '[]'::json) AS "data"
  FROM (
    SELECT row_to_json("__t".*) AS "data", "__t"."created_at" AS "__o0", "__t"."$$key" AS "__k", "__t"."id" AS "__pk0"
    FROM (
      SELECT 'photos' AS "$$key", "id", "created_at", "photo_url"
      FROM "photos" AS "__t1"
      WHERE "__t1"."user_id" = "__t0"."id" AND "__t1"."created_at" > $1
      ORDER BY "created_at" DESC LIMIT 20
    ) AS "__t"
    UNION ALL
    SELECT row_to_json("__t".*) AS "data", "__t"."created_at" AS "__o0", "__t"."$$key" AS "__k", "__t"."id" AS "__pk0"
    FROM (
      SELECT 'videos' AS "$$key", "id", "created_at"
      FROM "videos" AS "__t2"
      WHERE "__t2"."user_id" = "__t0"."id" AND "__t2"."created_at" > $1
      ORDER BY "created_at" DESC LIMIT 20
    ) AS "__t"
    ORDER BY "__o0" DESC, "__k" ASC, "__pk0" ASC
    LIMIT 20
  ) AS "__u"
) AS "__join_feed" ON true
```

- Each branch selects the member's columns plus a `$$key` literal, so the key lands in the JSON. Order columns are aliased per branch (`__o0`, …) because members may differ in DB column names; `__k` and the primary-key columns (`__pk0`, …) are appended as tiebreakers whenever an `orderBy` is present, which makes the order deterministic and keyset-paginable. Tiebreaker primary keys are only appended when every member's primary key has the same arity and data types; otherwise only `__k` is.
- Per-branch `LIMIT limit + offset` pushdown is valid because every branch orders by the same shared fields and tiebreakers. Without `limit` no pushdown happens.
- Table aliasing (`"__t0"`, `"__t1"`, …) is the fix for the "No table aliasing in joins" gap and is a prerequisite: a self-referential member (`archive_folders` inside `archive_folders`) cannot be expressed without it.
- Excluded members produce no branch. When every branch is pruned the operation returns `[]` (has-many) or `null` (has-one, belongs-to) without emitting SQL for that join; a top-level union query with no branches returns without a round trip.

### `$$key` pseudo-field

`$$key` is accepted in the shared `where` (`eq`, `neq`, `in`, and inside `and` / `or` / `not`) and in `orderBy`, typed as the union of member aliases. It never reaches SQL as a column reference: the normalizer evaluates it per branch, where the alias is a constant. A branch whose alias cannot satisfy the predicate is pruned; a branch that always satisfies it has the predicate dropped; a predicate mixing `$$key` with other fields inside `or` is emitted per branch with the literal substituted (`'videos' = 'videos' OR "created_at" > $1`, which the planner folds). `orderBy: { $$key }` orders by `__k`. The same applies to `on.<alias>.where` (no `$$key` there — it is constant) and to the top-level union client.

### Polymorphic belongs-to: reads, writes, filters

The registry binds the `from` column to a **dynamic key** `{ column: <discriminator> }` (Topic 1 binds static keys; this is the second binding form and amends A1/A2 there).

- **Read.** The result resolver wraps `counterpartyId` with `encodeGlobalId(row[discriminator], { [pkField]: value })`. When the id column is selected but the discriminator is not, the operations factory adds the discriminator to the SQL select; the resolver only emits requested fields, so the result shape is unchanged. A null discriminator leaves the id raw.
- **Write.** A wrapped id fills the discriminator when it is absent from `data` / `set`; when present and different, or when the key is not a member alias of the relation's union, `GlobalIdError("key_mismatch")`. A raw uuid leaves the discriminator untouched (lenient input, Topic 1 A8).
- **Filter.** `eq` / `neq` with a wrapped id → `(type = key AND id = pk)`; `in` → `OR` of per-key groups; a raw uuid → id only.
- **Join.** Branch predicate `AND <source>.<discriminator> = '<alias>'`; only one branch can match, and the outer `LIMIT 1` returns it.

### Pagination over a union

Offset pagination is the outer `LIMIT` / `OFFSET`. Keyset pagination encodes the shared order values, `$$meta.key` and the primary key (already a global id) through the column codecs; the predicate is applied inside each branch where the member key is a constant (`created_at < $c OR (created_at = $c AND ('photos' > $k OR ('photos' = $k AND id > $pk)))`, folded per branch), so the per-branch limit pushdown remains valid. The client pagination topic owns cursor encoding and the connection shape; it does not need a different SQL shape from the one above.

### Tenancy

`_validateWhereExpression(table, where)` is called once per branch with the member table, so a per-table predicate seam (client tenancy topic) applies to every member. A union that bypassed it for one member would be a cross-tenant read; the builder makes that structurally impossible by building each branch through the same `_resolveSelectParams`.

## Runtime design

| File | Change |
|---|---|
| `packages/core/src/definition/base.ts` | `Kind.UNION`. |
| `packages/core/src/definition/union.ts` (new) | `UnionDefinition<TMembers>` (`kind: UNION`, `name` = a synthetic name for errors, `members: Record<alias, TableDefinition>`, `columns`: shared column proxies carrying `dataType` and the alias, used only for `to` references and validation). Not serialized as DDL; `toJSON` lists member names (introspection). |
| `packages/core/src/definition/relations.ts` | `FieldRelation.target: AnyTableDefinition \| AnyUnionDefinition`; `to: TableDefinitionColumn<TTarget>[] \| { [alias]: column[] }` for union targets; `discriminator?: column` on belongs-to; `toJSON` emits `target: { kind: "UNION", name, members }`. |
| `packages/core/src/runtime/union.ts` (new) | `Union`: `alias`, `members: Record<alias, Table>`, `sharedColumns: Record<field, Record<alias, AnyColumn>>`, `getMemberColumn(alias, field)`. |
| `packages/core/src/runtime/registry.ts` | Registers `UnionDefinition` nodes (`getUnion`, `hasUnion`, `getUnions`); validates member keys against aliases, computes shared columns, validates relation `to` columns per member and belongs-to discriminators; binds the dynamic guid key on the `from` column (`bindGlobalIdTarget({ column })`); `getRelationTarget` returns `Table \| Union`. |
| `packages/core/src/runtime/query.ts` | `UnionSelectParams = { branches: { key: string; params: SelectParams; order: SQLNode[]; pk: SQLNode[] }[]; order; limit; offset }`; `buildUnionSelectQuery`; `_buildLateralJoin` accepts `JoinParams.params: SelectParams \| UnionSelectParams`; table aliasing `"__t<n>"` on every `FROM` (prerequisite story). |
| `packages/core/src/runtime/operation.ts` | `SelectOperationArgs.join` entries may carry union args (`on`, shared `where`/`orderBy`, `$$key` predicate already normalized to per-branch inclusion); `_resolveUnionJoinEntries` builds one branch per included member through `_resolveSelectParams(memberTable, …)` — so tenancy, codec-aware where and nested joins are inherited — and adds the `$$key` literal, the aliased order columns and tiebreakers; the resolver tree gains a union node `{ union, branches: { [alias]: { meta, fields } } }`; `_createResultResolver` dispatches per row on `$$key`, drops it, and stamps the member's `$$meta` (Topic 1 contract). A row whose `$$key` is not a branch throws (data-integrity error). `createUnionSelectOperation(union, request)` for the top-level client. Row-aware post-processing hook (shared with Topic 1's `$$meta.globalId`): wraps dynamic-key guid columns from the discriminator value; adds the discriminator to the select when needed. |
| `packages/dsqlbase/src/schema/union.ts` (new) | `union(members)`; exported from `packages/dsqlbase/src/schema/index.ts`. |
| `packages/dsqlbase/src/schema/relations.ts` | `hasMany` / `hasOne` accept a union target with `to` as shared columns or a per-member map; `belongsTo` accepts a union target with `discriminator`. |
| `packages/dsqlbase/src/client/model/normalizer.ts` | `_getJoinEntries` branches on the target kind; `_getUnionArgs(union, args)`: evaluates `$$key` predicates into branch inclusion, normalizes shared `select` / `where` / `orderBy` per member column, merges `on.<alias>` args, rejects `distinct`; discriminator expansion for where / insert / update values on dynamic-key guid columns. |
| `packages/dsqlbase/src/client/union/client.ts` (new) | `UnionClient` with `findOne` / `findMany` (no mutations); attached by the shared `attachModels` (Topic 1 story 2) under the union's alias. |
| `packages/dsqlbase/src/client/model/base.ts` | Types below. |

## Type design

- `UnionDefinition<TMembers extends Record<string, AnyTableDefinition>>`; `AnyUnionDefinition`; `SharedFieldsOf<TMembers>` = keys present in every member whose column `dataType` is identical across members (mismatched keys map to `never`); `UnionDefinition["columns"]: { [K in SharedFieldsOf]: UnionColumnDefinition<K, TMembers> }` typed enough for `to: [posts.columns.userId]`.
- `FieldRelation<TSource, TTarget extends AnyTableDefinition | AnyUnionDefinition, TType>`; `to` is the shared-column array or `{ [K in keyof TMembers]: TableDefinitionColumn<TMembers[K]>[] }`; `discriminator?: TableDefinitionColumn<TSource>` when `TType extends "belongs_to"` and `TTarget extends AnyUnionDefinition`.
- `RelationTargetOf` may resolve to a union; `RelationQueryOf` and `RelationJoinResultOf` branch on it.
- `UnionQueryArgs<TUnion, TSchema>` = `{ select?: Partial<Record<SharedFieldsOf, boolean>>; where?: WhereExpression over shared fields & { $$key?: KeyFilter<aliases> }; orderBy?: over shared fields & `$$key`; limit?; offset?; on?: OnSelectionOf<TUnion["members"], TSchema> }`.
- `OnSelectionOf<TMembers, TSchema> = { [K in keyof TMembers]?: Pick<QueryArgs<TableOf<TMembers[K]>, TSchema>, "select" | "where" | "join"> | boolean }` — exported from `packages/dsqlbase/src/client/model/base.ts` and **used by `$findByGlobalId` / `$listByGlobalId`** (Topic 1's `GlobalIdOptionsOf<S>` is `OnSelectionOf<NodeTablesOf<S>, S>`).
- `UnionResultOf<TUnion, TSchema, TArgs>` = union over members not excluded by `on.<alias>: false` of `Prettify<SharedSelection & MemberSelection & MemberJoins & { $$meta: RecordMetaOf<TableOf<member>> }>`; narrowing on `$$meta.key` works because `key` is a literal alias per member. Static `$$key` predicates in `where` are not reflected in the result type (they are runtime values).
- `QueryResultOf` and `RelationJoinResultOf` produce `UnionResultOf[]` for has-many and `UnionResultOf | null` for has-one / belongs-to.
- Dynamic-key guid columns keep `valueType: string`.
- Type tests in `packages/dsqlbase/src/client/model/client.types.test.ts` and a new `union.types.test.ts`.

## Migration impact

None. `UnionDefinition` produces no DDL; `RelationsDefinition.toJSON` changes shape only for union targets (introspection, not migrations). A polymorphic belongs-to column cannot carry a foreign key — noted for the migration topic; the member-side key columns of a has-many relation can. No DSQL capability is involved.

## Failure modes

| Input | Behaviour |
|---|---|
| Union key ≠ member alias; member not in the schema; empty union; nested union | throws at `createClient` |
| `to` column missing on a member, or `to` from `union.columns` names a non-shared field | throws at `createClient` |
| `belongsTo(union)` without `discriminator`; discriminator not text-like or not on the source; `from` column with a static guid key | throws at `createClient` |
| Shared `select` / `where` / `orderBy` naming a non-shared field; `distinct` on a union; `$$key` value that is not a member alias | throws at normalization |
| Write with a wrapped id whose key is not a member alias, or contradicts an explicit discriminator value | `GlobalIdError("key_mismatch")` |
| Result row whose `$$key` is not a branch (cannot happen from this builder; stale data via `$query` is raw) | throws |
| All branches pruned | `[]` / `null` / empty list without SQL |
| Discriminator `NULL` on read | id returned raw; the join yields `null` |

## Stories, ordering, changesets

All changesets `minor` on the fixed group. Ordered after the shared prerequisites listed in `.claude/proposals/schema-guid.md` stories 1–3 and 5 and the two additional gap fixes below; each story names its docs pages and is not done until they are updated in the same PR.

0. **Prerequisites shared with Topic 1** — `.claude/proposals/schema-prerequisites.md`, stories 1–7: runtime primary key; `Table.alias` + shared `attachModels`; `$$meta` + resolver tree with per-level table context and a row-aware post-processing hook; codec-aware where; **table aliasing in lateral joins** (listed gap, needed by self-referential members); **composite relation pairs** (listed gap, branch predicates use every `from[i]` / `to[i]`).
1. **`union()` definition + registry.** `Kind.UNION`, `UnionDefinition`, runtime `Union`, member/shared-column validation, `getRelationTarget` returning a union. Docs: `docs/guide/schema.md`, `docs/internals/architecture.md`.
2. **`UNION ALL` builder + has-many / has-one union joins + `on`.** `buildUnionSelectQuery`, `_resolveUnionJoinEntries`, per-row dispatch, tiebreakers, limit pushdown, types (`UnionQueryArgs`, `OnSelectionOf`, `UnionResultOf`). Docs: new `docs/guide/polymorphic-relations.md`, `docs/guide/relations.md`, `docs/guide/querying.md`, `docs/internals/runtime-pipeline.md`.
3. **`$$key` pseudo-field.** Normalizer evaluation into branch pruning, `orderBy: { $$key }`, types. Docs: `docs/guide/polymorphic-relations.md`.
4. **Top-level `UnionClient`.** `createUnionSelectOperation`, `findOne` / `findMany`, attachment by alias, transaction client parity. Docs: `docs/guide/querying.md`, `docs/guide/transactions.md`.
5. **Polymorphic belongs-to.** `discriminator` on `belongsTo`, dynamic guid key binding, read wrapping, write auto-fill, where expansion, branch predicate. Depends on Topic 1 story 6 (guid codec) for the wrapped form; without it the join and the discriminator auto-fill still work on raw ids. Docs: `docs/guide/polymorphic-relations.md`, `docs/guide/relations.md`, `docs/guide/global-ids.md`, `docs/internals/codec-boundary.md`.

External follow-up (gqlbase, not a dsqlbase story): `DsqlBaseSchemaGeneratorPlugin` emits `union({ … })` per GraphQL union / interface (members = implementing `@model` types, keyed by alias), `hasMany(union, …)` / `belongsTo(union, { …, discriminator })` for relation fields typed with them, and a `<key>Type` text column next to each `@belongsTo` key that targets a union or interface; a resolver argument for the member type maps to `where: { $$key }`.

### Breaking surface

- `FieldRelation.target` widens to `TableDefinition | UnionDefinition`; `RelationTargetOf` consumers that assume a table must narrow.
- `RelationsDefinition.toJSON` shape changes for union targets.
- `$$key` becomes a reserved field alias.
- `JoinParams.params` widens; `FieldResolver` gains a union node (already changing shape in Topic 1).
- Lateral joins reference tables through aliases (SQL text changes; behaviour unchanged for non-self joins).

Level: `minor`, each item named in the changeset body with a `Docs:` line per story.

## Test plan

- **core unit** (`packages/core/src`): `union.test.ts` (definition, member key validation, shared-field intersection incl. a `dataType` mismatch, nested union rejected); `registry.test.ts` (union registration, `to` validation per member and per-member map, discriminator validation, dynamic key binding, static key + discriminator rejected); `query.test.ts` SQL snapshots for has-many / has-one / belongs-to union joins, top-level union select, tiebreakers, limit + offset pushdown, single-branch union, pruned-to-empty; `operation.test.ts` per-row dispatch, `$$key` dropped, `$$meta` per branch, unknown `$$key` throws, discriminator auto-selected and not emitted; table-alias snapshots for a self-referential member.
- **dsqlbase unit** (`packages/dsqlbase/src`): `union()` builder; normalizer `on` merging (`true` / `false` / args), shared where applied per member column, `$$key` evaluation (`eq`, `in`, `neq`, inside `or` with another field, all pruned), `distinct` rejected, discriminator expansion for `eq` / `in` / raw, insert and update auto-fill and mismatch; type tests for `SharedFieldsOf`, `OnSelectionOf` (also as the `$findByGlobalId` argument), `UnionResultOf` narrowing on `$$meta.key`, excluded member removed from the result union, `$$key` typed to aliases.
- **e2e, PGlite** (`packages/tests/src/specs`): extend `db/schema/schema.ts` with `photos`, `videos`, `posts = union({ photos, videos })`, `users.feed`, a polymorphic `comments.subject` belongs-to with a `subjectType` discriminator, and a self-referential `folders.entries` union; new `polymorphic.spec.ts`: feed ordered across members by `createdAt` with `limit` / `offset`, excluded member, `on` per-member select and nested join, `$$key` filter from a runtime value, `$$meta.key` / `__typename` on every row, has-one to a union, belongs-to read with `subjectId === subject.id`, create with a wrapped id fills `subjectType`, mismatch throws, filter by wrapped id, top-level `dsql.posts.findMany` with `where` / `orderBy` / `limit`, self-referential member join, `$findByGlobalId` with the `on` map. Failing tests that expose real bugs stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): new `polymorphic-relations.md` (GraphQL mapping table, `union()`, shared fields, `on`, `$$key`, ordering and pagination across members, polymorphic belongs-to with the discriminator, top-level union client, limits: no FK on the belongs-to column, no `distinct`); `relations.md` (union targets, per-member `to`, `discriminator`); `querying.md` (`on`, `$$key`, `UnionClient`); `schema.md` (`union()`, reserved aliases); `transactions.md` (union client on the transaction client); `global-ids.md` (dynamic keys, `$findByGlobalId` takes an `on` map).
- **Internals** (`docs/internals/`): `runtime-pipeline.md` (gaps closed: table aliasing, composite pairs; union resolver node; union builder; `$$key` evaluation in the normalizer); `codec-boundary.md` (dynamic-key wrapping happens in the row-aware resolver hook, not in `Column.resolve`); `architecture.md` (new files); `dsql-capabilities.md` unchanged (no new capability).
- **Decision record**: `docs/decisions/0004-polymorphic-relations.md` on acceptance; this proposal is then deleted.
- **Stale lines**: root `README.md` showcase; `packages/dsqlbase/README.md` relations section.
- **Cross-topic notes to carry forward**: the client pagination topic reuses the union order + tiebreaker shape for keyset cursors; the tenancy topic's predicate seam must be per table (branches call it per member); the migration topic notes that polymorphic belongs-to columns cannot carry FKs; Topic 1 (`schema-guid.md`) is amended for dynamic keys and `OnSelectionOf` (see that file).
