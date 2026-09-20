---
proposal: client-runtime-joins
status: draft
owner: silviu
created: 2026-09-20
---

# Client runtime joins: ad-hoc lateral joins, filtered relations, counts, and column references in `where`

Prime: `.claude/prime/03-client.md` Topic 2. Review context: `.claude/prime/00-review.md`, `docs/internals/runtime-pipeline.md` ("Relations and joins"). Depends on `.claude/proposals/schema-prerequisites.md` stories 3 (table aliasing, **amended here**), 4 (composite relation pairs), 5 (`$$meta`) and the new story 9 (one field namespace per table, added here).

## Problem

A `join` can only name a relation declared in the schema. The machinery behind it is already general — `QueryBuilder._buildLateralJoin` (`packages/core/src/runtime/query.ts`) emits a `LEFT JOIN LATERAL` over a full nested `buildSelectQuery`, wrapped as `row_to_json` or `json_agg` — but the only entry point is a relation name, so the relation supplies the three things a join needs: the target table, the correlation to the parent row, and the cardinality. The reference application hits the limit immediately: the same relation under a second key with a different filter (`members` and `activeMembers`), a count of related rows, a target that was never declared as a relation, and a predicate that compares a column with a parent column. Each of those is written today as a second query per row or as raw `$query`, outside the tenancy predicates Topic 3 will add.

### What the code does today (verified 2026-09-20)

- `RequestNormalizer._getJoinEntries` (`packages/dsqlbase/src/client/model/normalizer.ts`) accepts `true` or a nested `QueryArgs` per **relation name**, resolves the target with `SchemaRegistry.getRelationTarget`, and emits `[fieldName, SelectOperationArgs][]`.
- `OperationsFactory._resolveJoinEntries` (`packages/core/src/runtime/operation.ts`) looks the relation up again, uses `relation.from[0]` / `to[0]` only (prerequisite story 4), builds the connection predicate with `sql.eq`, and calls `_resolveSelectParams(targetTable, …)` — the same method that will host tenancy injection (`_validateWhereExpression`). `JoinParams.from` / `to` are filled but never read by the builder.
- `QueryBuilder._buildLateralJoin` references the inner table by raw name and uses the fixed alias `"__t"` for the JSON wrapper; a table joined to itself is ambiguous in SQL and resolves to the inner table silently (prerequisite story 3).
- `_getWhereExpression` calls `sql.eq(column, value)`; `asNode` (`packages/core/src/sql/tag.ts`) passes any `SQLNode` value through untouched, so a column-valued filter **already works at runtime** for a foreign table — the type `WhereExpressionOf` (`packages/dsqlbase/src/client/model/base.ts`) rejects it, and a self-join renders wrong (above).
- `SQLContext` (`packages/core/src/sql/nodes.ts`) carries `inlineParams`, a parameter counter and two escape functions; it has no notion of query scope, so `Column.toSQL` cannot know which `FROM` it belongs to.
- `FieldSelectionOf` is `Partial<Record<FieldNamesOf<T>, boolean>>`; `_getSelectionEntries` throws on a key that is not a column.
- Nothing rejects a relation whose name equals a column alias on the same table (`SchemaRegistry._buildTables`, `Table._buildColumns`); `QueryResultOf` would intersect the two types.
- The `.claude/prime/improvements.md` sketch moves relations into `select` and repurposes `join`; Prisma's `select`/`include` and Drizzle's `with` are relation-only, and Prisma's nested relation value is a full query object (`select` + `where` + `orderBy` + `take`), not a field map. The closest analog to what is wanted is Kysely's `jsonObjectFrom` / `jsonArrayFrom` lateral helpers.

## Decisions taken during grilling

1. **Needs.** Same relation with another filter (a) and counts (d) are daily; an undeclared target (b) is occasional; arbitrary predicates (c) fall out of the design and are not a goal.
2. **`select` vs `join`.** `select` = values of this row (columns, embeddable groups) **plus** a relation as a bare field map (all rows, default order). Anything with filters, order, limit, nested joins or an ad-hoc target lives in `join`. The same relation in both is an error at the type level and at runtime. No breaking reshape.
3. **Self-joins are in scope.** The builder aliases every `FROM` unconditionally (story 3); references carry their scope explicitly.
4. **Cardinality is explicit** on object entries: `type?: "one" | "many" | "count"`, default `"many"`.
5. **Tenancy predicates apply to every nested target**, including ad-hoc and count entries, with no opt-out — enforced by routing every target through `_resolveSelectParams`.
6. **Aggregates:** `count` only. Sums, expressions and raw `sql` values in `select` are a later topic.
7. **`where` is an object or a callback.** The callback receives the current table's column references and, in nested levels, the parent's: `(self, parent) => where`. A value position accepts a column reference in addition to a literal. Field-level callbacks and raw SQL values are **not** in this topic; the reference slot is where they would go.
8. **One field namespace per table.** Columns, relations (and later embeddable groups) may not share a name; rejected at schema build (prerequisite story 9).

## Decision

Three join entry forms under one `join` key — a declared relation (`true` / `QueryArgs`, unchanged), a **filtered relation** (`{ relation, where, select, orderBy, limit, join, type?: "count" }`) and an **ad-hoc entry** (`{ from, type, where, select, orderBy, limit, join }`) — plus a relation named under `select` as a bare field map, which the normalizer lowers to the first form. `where` everywhere accepts an object or a callback `(self, parent) => object`, and every value position accepts a `ColumnRef` (a column of the current or parent scope). After normalization there is one internal representation per join — `{ fieldName, target, type, correlation, args }` — and the operations factory no longer looks relations up itself. `type: "count"` emits `count(*)` directly in the lateral and resolves to a `number`. An ad-hoc entry that never references the parent row is refused.

### Rejected options (one line each)

- **Relations moved into `select`, `join` repurposed for ad-hoc entries** (the `improvements.md` sketch) — breaks every `join:` caller at type and runtime, overloads `select` (column / group / relation under one syntax), and a bare field map has no room for `where` / `orderBy` / `limit` on has-many relations, which `join` supports today.
- **Filtered relations only** (`{ relation, where }`, no ad-hoc target) — covers need (a) alone; no undeclared targets, no counts, no column-vs-column predicates.
- **Schema-time filtered relations** (`hasMany(members, { from, to, where })`) — bakes query concerns into definitions and cannot be parameterised; the query-time `relation:` form covers it.
- **Virtual / computed fields in `select`** (`select: { activeCount: sql\`…\` }`) — needs a typed `sql<T>` tag, collides with the embeddables reshaping of `select`, and raw SQL bypasses tenancy injection; deferred to its own topic.
- **Field-level where callbacks** (`{ id: (c) => … }`) — a rewrite of the whole where grammar; too much surface for this topic. The `ColumnRef` value slot keeps the door open.
- **Column map for correlation** (`on: { id: "ownerId" }`) — equality only, heavier cross-table typing, and it does not remove the need for scoped references (declared self-relations need them anyway).
- **String markers** (`"$parent.id"`) — collide with legitimate string values, untyped.
- **Kysely-style query builder** — a second query language next to the model client, bypasses tenancy; `$query` with the `sql` tag remains the raw escape hatch.
- **Inferring cardinality from unique constraints** — fragile and invisible when reading a query.

## API

```ts
const workspace = await dsql.workspaces.findOne({
  where: { id },
  select: {
    id: true,
    name: true,
    members: { id: true, role: true },            // relation as a field map: all rows, default order
  },
  join: {
    // declared relation with args — unchanged
    projects: { where: { archived: false }, orderBy: { name: "asc" } },

    // filtered relation: correlation from the schema (all from/to pairs), user adds the filter
    activeMembers: {
      relation: "members",
      where: { status: "ACTIVE" },
      select: { id: true, role: true },
      orderBy: { createdAt: "desc" },
      limit: 10,
      join: { user: true },                       // the target's own relations, any form
    },
    activeCount: { relation: "members", type: "count", where: { status: "ACTIVE" } },

    // ad-hoc: target by schema alias, correlation from the query
    owner: {
      from: "users",
      type: "one",
      where: (u, w) => ({ id: w.ownerId }),      // u = users refs, w = workspaces refs
      select: { id: true, name: true },
    },
    overdue: {
      from: "tasks",                              // default type: "many"
      where: (t, w) => ({ workspaceId: w.id, dueDate: { lt: w.reviewedAt }, status: "open" }),
    },
    overdueCount: {
      from: "tasks",
      type: "count",
      where: (t, w) => ({ workspaceId: w.id, dueDate: { lt: w.reviewedAt } }),
    },
  },
});

workspace.members;        // { id; role }[]
workspace.activeMembers;  // { id; role; user: … }[]
workspace.activeCount;    // number
workspace.owner;          // { id; name } | null
workspace.overdue;        // Task[]

// callback where at the root: column vs column on the same table
await dsql.tasks.findMany({ where: (t) => ({ completedAt: { gt: t.dueDate } }) });

// declared relation with an extra parent-correlated filter
await dsql.users.findMany({ join: { posts: { where: (p, u) => ({ createdAt: { gt: u.joinedAt } }) } } });
```

Rules:

- `from` is a **schema alias** — the key used for `dsql.<alias>` — resolved through `SchemaRegistry.getTable`. A `from` that names the parent's own table is allowed (self-join, story 3). A `from` naming a union alias (`schema-polymorphic-relations.md`) throws in v1.
- `type` defaults to `"many"`. On the filtered-relation form only `"count"` may be given; `one` ↔ `many` is defined by the relation.
- `type: "count"`: `select`, `orderBy`, `join`, `limit`, `offset`, `distinct` are not accepted (type `never`, runtime throw). Result is `number`.
- `type: "one"` applies `LIMIT 1`; without `orderBy` the row is arbitrary when several match (same as `hasOne` today).
- An **ad-hoc entry must reference the parent row**: the parent ref proxy records accesses during normalization; a plain-object `where` or a callback that touched no parent field throws `Ad-hoc join "<key>" on "<table>" does not reference the parent row`. Declared and filtered relations are correlated by the schema and are not checked.
- A relation under `select` takes a field map only (`true` or `{ field: true }`); the same relation under `select` and `join` throws `Relation "<name>" appears in both select and join`.
- An ad-hoc key may reuse a relation name (`members: { from: "members", … }`); the object shape disambiguates and overrides the relation for that query.
- `where` callback: `(self, parent) => WhereExpression`. `self` = refs to the current table's fields; `parent` = refs to the enclosing table's fields, `undefined` at the root. Only the immediate parent is exposed; inside a nested entry the parent is the intermediate target. A ref must match the field's value type.
- The same `where` shape applies to `findOne`, `findMany`, `paginate`, `count`, `update`, `delete` and every nested level.

## Generated SQL

Aliases follow prerequisite story 3 as amended below: `"__t<n>"` per `FROM`, `"__j<n>"` per JSON wrapper.

Ad-hoc `many` with a nested relation, and a `count`:

```sql
SELECT "__t0"."id", "__t0"."name",
       "__join_overdue"."data" AS "overdue",
       "__join_overdueCount"."data" AS "overdueCount"
FROM "workspaces" AS "__t0"
LEFT JOIN LATERAL (
  SELECT COALESCE(json_agg(row_to_json("__j1".*)), '[]'::json) AS "data"
  FROM (
    SELECT "__t1"."id", "__t1"."title", "__join_assignee"."data" AS "assignee"
    FROM "tasks" AS "__t1"
    LEFT JOIN LATERAL (
      SELECT row_to_json("__j2".*) AS "data"
      FROM (SELECT "__t2"."id", "__t2"."name" FROM "users" AS "__t2"
            WHERE "__t2"."id" = "__t1"."assignee_id" LIMIT $1) AS "__j2"
    ) AS "__join_assignee" ON true
    WHERE "__t1"."workspace_id" = "__t0"."id" AND "__t1"."due_date" < "__t0"."reviewed_at" AND "__t1"."status" = $2
  ) AS "__j1"
) AS "__join_overdue" ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS "data"
  FROM "tasks" AS "__t3"
  WHERE "__t3"."workspace_id" = "__t0"."id" AND "__t3"."due_date" < "__t0"."reviewed_at"
) AS "__join_overdueCount" ON true
WHERE "__t0"."id" = $3
```

Filtered relation (correlation from the declared pairs — both columns of a composite relation, story 4):

```sql
LEFT JOIN LATERAL (
  SELECT COALESCE(json_agg(row_to_json("__j1".*)), '[]'::json) AS "data"
  FROM (
    SELECT "__t1"."id", "__t1"."role"
    FROM "members" AS "__t1"
    WHERE ("__t1"."workspace_id" = "__t0"."id" AND "__t1"."region" = "__t0"."region") AND "__t1"."status" = $1
    ORDER BY "__t1"."created_at" DESC
    LIMIT $2
  ) AS "__j1"
) AS "__join_activeMembers" ON true
```

Self-join, `one` (impossible today — both sides would render `"members"."…"`):

```sql
SELECT "__t0"."id", "__join_invitedBy"."data" AS "invitedBy"
FROM "members" AS "__t0"
LEFT JOIN LATERAL (
  SELECT row_to_json("__j1".*) AS "data"
  FROM (SELECT "__t1"."id", "__t1"."email" FROM "members" AS "__t1"
        WHERE "__t1"."id" = "__t0"."invited_by_id" LIMIT $1) AS "__j1"
) AS "__join_invitedBy" ON true
```

`select: { members: { id: true, role: true } }` produces exactly the SQL of `join: { members: { select: { id: true, role: true } } }`.

With tenancy (Topic 3) the injected predicate appears inside every lateral `WHERE` above, AND-ed before the correlation, because each target passes through `_resolveSelectParams`.

## Runtime design

Per layer of `docs/internals/runtime-pipeline.md`.

- **`packages/core/src/sql`** — `ColumnRef` node and `Scope` token come from prerequisite story 3 (amended). This topic adds nothing to the tag.
- **Normalizer** (`packages/dsqlbase/src/client/model/normalizer.ts`)
  - `_getSelectArgs(table, args, scope, parent?)` allocates one `Scope` per level (story 3) and passes `{ scope, parentScope, parentTable }` down. `SelectOperationArgs` gains `scope: Scope`.
  - `_getWhereExpression(table, where, refs)` — when `where` is a function it is called with `(refs.self, refs.parent)` and the result is normalized as an object; unchanged otherwise. `refs.self` / `refs.parent` are `ColumnRefsOf` proxies: each property returns `new ColumnRef(column, scope)`, and the parent proxy records accessed fields on a per-entry set. Values that are `SQLNode`s already pass through `asNode`.
  - `_getSelectionEntries` — a key that names a relation (and not a column; guaranteed distinct by story 9) is removed from the selection and pushed into the join list as `{ relation: key, select: <map> }` (`true` → no select). If `join` also has that key, throw.
  - `_getJoinEntries` — returns `JoinEntry[]`: `{ fieldName, target, type, correlation?, args }`. Per entry shape: `true` / `QueryArgs` → target from `getRelationTarget`, correlation = `sql.and` over all `from[i]`/`to[i]` pairs as `ColumnRef`s of the two scopes (story 4), type from the relation; `{ relation, … }` → same, `type: "count"` allowed; `{ from, … }` → `schema.getTable(from)` (throw if unknown or a union alias), `type` from the entry (default `many`), correlation `undefined`, and after normalizing `args.where` the accessed-parent set must be non-empty, else throw. For `count`, the presence of `select` / `orderBy` / `join` / `limit` / `offset` / `distinct` throws.
- **Operations factory** (`packages/core/src/runtime/operation.ts`)
  - `SelectOperationArgs.join?: JoinEntry[]` replaces `[fieldName, SelectOperationArgs][]`.
  - `_resolveJoinEntries(table, join, resolvers)` no longer calls `getRelation` / `getRelationTarget`: for each entry it calls `_resolveSelectParams(entry.target, entry.args, mode)` (so `_validateWhereExpression` — the injection seam — runs on the target first), then `where = and([correlation?, params.where?])`. For `type: "count"` it builds `SelectParams` with `select: [sql\`count(*) AS "data"\`]` and registers a scalar resolver `(v) => Number(v)` instead of a nested resolver tree; `one` / `many` register the nested tree as today. `mode` is `"one"` for `one`, `"many"` otherwise.
  - `JoinParams.type` becomes `"one" | "many" | "count"`; `JoinParams.from` / `to` are removed (dead today).
  - `_createResultResolver` (the story 5 tree) gains a scalar leaf kind for `count`; `$$meta` is stamped on `one` / `many` rows as story 5 specifies, not on counts.
- **Query builder** (`packages/core/src/runtime/query.ts`) — `_buildLateralJoin`: for `count`, the lateral body is the inner select itself (`SELECT count(*) AS "data" FROM … WHERE …`), no `row_to_json` wrapper; `one` / `many` unchanged. Alias rendering is story 3.
- **Context** (`packages/core/src/runtime/context.ts`) — no change.
- **Model client** (`packages/dsqlbase/src/client/model/client.ts`) — no runtime change; the generic constraints pick up the new types. `findOne` JSDoc gains the three join forms.

Ordering guarantee for tenancy: in every lateral, the target's injected predicate is produced by `_resolveSelectParams(target)` and the correlation is AND-ed afterwards; an ad-hoc `where` can therefore never widen the tenant boundary.

## Type design

`packages/dsqlbase/src/client/model/base.ts` unless noted. New generic parameters default so that existing call sites compile unchanged.

```ts
// packages/core/src/sql (prerequisite story 3)
export class ColumnRef<V = unknown> implements SQLNode { readonly column: AnyColumn; readonly scope: Scope; }

export type ColumnRefsOf<T extends AnyTable> = {
  readonly [K in FieldNamesOf<T>]: ColumnRef<ValueTypeOf<ColumnTypeOf<T, K>>>;
};

// where: every value position accepts a ref of the same value type
export interface FilterCondition<V> { eq?: V | ColumnRef<V>; neq?: …; gt?: …; gte?: …; lt?: …; lte?: …;
  in?: (V | ColumnRef<V>)[]; between?: [V | ColumnRef<V>, V | ColumnRef<V>]; exists?: boolean;
  beginsWith?: string; endsWith?: string; contains?: string; }
export type WhereExpressionOf<T> = { [K in FieldNamesOf<T>]?: FilterCondition<V_K> | V_K | ColumnRef<V_K> } & { and?; or?; not? };

export type WhereArgOf<T extends AnyTable, P extends AnyTable = never> =
  | WhereExpressionOf<T>
  | ((self: ColumnRefsOf<T>, parent: [P] extends [never] ? undefined : ColumnRefsOf<P>) => WhereExpressionOf<T>);

// query args gain the parent table
export interface QueryArgs<TTable, TSchema, TParent extends AnyTable = never> {
  select?: FieldSelectionOf<TTable>;
  where?: WhereArgOf<TTable, TParent>;
  orderBy?; distinct?; limit?; offset?;
  join?: { [K in string]?: JoinEntryOf<TTable, TSchema, K> };
}

// select sugar: relations as bare field maps
export type FieldSelectionOf<T> = Partial<Record<FieldNamesOf<T>, boolean>> & {
  [R in RelationFieldNamesOf<T>]?: true | Partial<Record<FieldNamesOf<RelationTargetTableOf<T, R>>, boolean>>;
};

// join entry forms
type JoinBodyOf<Target, S, Parent> = Pick<QueryArgs<Target, S, Parent>, "where" | "select" | "orderBy" | "limit" | "join">;
type CountBody<Target, Parent> = { type: "count"; where?: WhereArgOf<Target, Parent>;
  select?: never; orderBy?: never; join?: never; limit?: never; offset?: never; distinct?: never };

export type FilteredRelationJoinOf<T, S> = {
  [R in RelationFieldNamesOf<T>]:
    | ({ relation: R; type?: never } & JoinBodyOf<RelationTargetTableOf<T, R>, S, T>)
    | ({ relation: R } & CountBody<RelationTargetTableOf<T, R>, T>);
}[RelationFieldNamesOf<T>];

export type AdHocJoinOf<T, S> = {
  [A in TableAliasesOf<S>]:
    | ({ from: A; type?: "one" | "many" } & JoinBodyOf<TableByAlias<S, A>, S, T>)
    | ({ from: A } & CountBody<TableByAlias<S, A>, T>);
}[TableAliasesOf<S>];

export type JoinEntryOf<T, S, K> = K extends RelationFieldNamesOf<T>
  ? boolean | RelationQueryOf<T, S, K> | FilteredRelationJoinOf<T, S> | AdHocJoinOf<T, S>
  : FilteredRelationJoinOf<T, S> | AdHocJoinOf<T, S>;
```

- `FilteredRelationJoinOf` and `AdHocJoinOf` are **discriminated unions keyed by the literal** (`relation: R`, `from: A`): writing `from: "members"` contextually types `where`, `select`, `orderBy` and `join` against `members`, and the callback's `self` against `members`, `parent` against the enclosing table. The union has one member per table (or relation); acceptable at tens of tables.
- `RelationQueryOf<T, S, K>` passes `T` as `TParent`, so a declared relation's `where` callback sees the parent refs (the `posts` example above).
- `join` is a mapped type over `string`, i.e. an index signature: ad-hoc keys are free, relation-named keys still get their specific type. `JoinExpressionOf` is removed; `AnyRelationQuery` grows the two object forms (`packages/dsqlbase/src/client/model/normalizer.ts` imports it).
- `select` / `join` overlap: `findOne` / `findMany` / `paginate` constrain `TArgs extends QueryArgs<…> & NoSelectJoinOverlap<TArgs>` where the helper is `{}` when `Extract<keyof TArgs["select"], keyof TArgs["join"]>` is `never`, otherwise `{ select: never }` — producing a compile error at the call site.
- `QueryResultOf` dispatch per `join` key: `true` / `RelationQueryOf` → as today; `{ relation }` → the relation's target shaped by its cardinality (`[]` / `| null`), `number` when `type: "count"`; `{ from, type }` → `QueryResultOf<TableByAlias<S, from>, S, entry>` wrapped `| null` (`one`), `[]` (`many`), `number` (`count`). Relation keys under `select` add the same shape as `join: { r: true }` with the given field map. Rows carry `$$meta` per story 5; counts do not.
- `WhereArgOf<T>` (no parent) replaces `WhereExpressionOf<T>` in `FindOneArgs`, `UpdateArgs`, `DeleteArgs`, and the pagination proposal's `PaginateArgs` / `CountArgs`.

## DSQL constraints

Nothing new: `LEFT JOIN LATERAL`, `row_to_json`, `json_agg` and `count(*)` are what the client emits today. `docs/internals/dsql-capabilities.md` needs no verification item from this topic. Each lateral is a correlated subquery executed per parent row; a `count` lateral reads an index range on the correlation columns when one exists, otherwise scans the target per parent — the guide says so and recommends an index on the correlation columns.

## Failure modes

| Situation | Behaviour |
|---|---|
| `from` names an unknown alias | Error at normalize: `Table not found: <alias>` |
| `from` names a union alias | Error at normalize: unions are joined through declared relations (`on`) |
| Ad-hoc entry with no parent reference (plain object, or callback that touched none) | Error at normalize: `Ad-hoc join "<key>" on "<table>" does not reference the parent row` |
| Parent ref touched but dropped from the returned object | Slips through as uncorrelated (documented; a tree walk is not worth it) |
| Ref of a mismatched value type (`text` ref into a `uuid` field) | Compile error; at runtime Postgres raises a type error |
| `type: "one"`, several matches, no `orderBy` | Arbitrary row (`LIMIT 1`), documented; same as `hasOne` |
| `type: "count"` with `select` / `orderBy` / `join` / `limit` / `offset` / `distinct` | Compile error; runtime throw |
| `one` / `many` given on the filtered-relation form | Compile error; runtime throw (the relation defines cardinality) |
| Same relation in `select` and `join` | Compile error; runtime throw `Relation "<name>" appears in both select and join` |
| Relation named like a column | Error at schema build (story 9) |
| Self-join before story 3 | Not possible — story 3 is a hard prerequisite of story A below |
| Where values with codec columns | Still bypass codecs until prerequisite story 7; `ColumnRef` values are never encoded |
| Tenant table as ad-hoc target (Topic 3) | Injected predicate applies inside the lateral, before the correlation |

## Interplay

- **Pagination (`client-pagination.md`)**: `paginate` accepts all join forms and the `select` sugar; only the root is keyset-ordered, nested lists are not paginated. `PaginateArgs.where` / `CountArgs.where` become `WhereArgOf<T>` (callback with `self` only). Root `where` callbacks compose with the keyset predicate exactly like object wheres — both are SQL nodes by the time they reach `_resolveSelectParams`.
- **Tenancy (`client-tenancy.md`)**: every target — relation, filtered, ad-hoc, count — passes through `_resolveSelectParams(target)`, so one injection point (`_resolveWhere`, the renamed and now unconditional `_validateWhereExpression`) covers all of them; correlation is AND-ed after injection; a tenant table reached as a target without claims on an enforce-mode client throws `TenancyError` naming the target. `ColumnRef` values in a where are column references, not literals, so a tenant-column predicate injected on the target cannot be satisfied by a parent ref.
- **Polymorphic relations (`schema-polymorphic-relations.md`)**: unions are not valid `from` targets in v1; `on` is untouched. Union branches allocate scopes through the same normalizer allocator, so a member equal to the parent table renders correctly (that proposal already lists story 3 as a prerequisite).
- **Global ids (`schema-guid.md`)**: `ColumnRef<Guid>` is assignable only to guid-typed fields; guid codecs are never applied to refs. Prerequisite story 7 (codec-aware where) must skip `ColumnRef` values — noted there.
- **Embeddable objects (`schema-embeddable-objects.md`)**: `select: { billing: { city: true } }` (group) and `select: { members: { id: true } }` (relation) are told apart by name thanks to story 9. `ColumnRefsOf` exposes flat fields; refs to group leaves (`t.billing.city`) are specified in that proposal's runtime story when it lands.
- **gqlbase**: a GraphQL selection set maps onto `select` (columns and relations); connection fields map onto `paginate`; per-field filters map onto `join` entries.

## Stories, ordering, changesets

Fixed version group (`@dsqlbase/core`, `dsqlbase`, `@dsqlbase/migration`); each story is `minor`.

### A. Column references and callback `where`

- **Change.** `ColumnRefsOf` proxies built by the normalizer per scope; `WhereArgOf` accepted everywhere `where` is (`findOne`, `findMany`, `update`, `delete`, nested relation joins, later `paginate` / `count`); `FilterCondition` / `WhereExpressionOf` value positions accept `ColumnRef`; `RelationQueryOf` passes the parent table so declared relations get parent refs; `SelectOperationArgs.scope`.
- **Depends on.** `schema-prerequisites.md` story 3 as amended (unconditional aliasing, `ColumnRef`, normalizer-owned scopes).
- **Tests.** See test plan (A rows).
- **Docs.** `docs/guide/querying.md`, `docs/guide/relations.md`, `docs/internals/runtime-pipeline.md`, `docs/internals/codec-boundary.md`. Changeset: `minor` — `where` accepts a callback; `QueryArgs` gains a defaulted generic (`Docs: docs/guide/querying.md, docs/guide/relations.md, docs/internals/runtime-pipeline.md, docs/internals/codec-boundary.md`).

### B. Ad-hoc and filtered join entries

- **Change.** `JoinEntry` internal shape; normalizer lowers all forms; correlation built in the normalizer over all relation pairs; ad-hoc correlation check; `_resolveJoinEntries` consumes `JoinEntry` and stops looking relations up; `JoinParams.from` / `to` removed; `FilteredRelationJoinOf`, `AdHocJoinOf`, `JoinEntryOf` types, `JoinExpressionOf` removed; `QueryResultOf` dispatch for `one` / `many` object forms; union-alias refusal.
- **Depends on.** Story A; `schema-prerequisites.md` stories 4 and 9.
- **Tests.** See test plan (B rows).
- **Docs.** New `docs/guide/joins.md`; `docs/guide/relations.md`; `docs/internals/runtime-pipeline.md`. Changeset: `minor` — `SelectOperationArgs.join` and `JoinParams` shapes change in `@dsqlbase/core`; `JoinExpressionOf` removed from `dsqlbase` exports (`Docs: docs/guide/joins.md, docs/guide/relations.md, docs/internals/runtime-pipeline.md`).

### C. `count` cardinality and `select` relation sugar

- **Change.** `type: "count"` on both object forms: normalizer validation, `count(*)` lateral in `_buildLateralJoin`, scalar resolver leaf, `CountBody` types, `number` in `QueryResultOf`; relation keys in `FieldSelectionOf`, lowering in `_getSelectionEntries`, `NoSelectJoinOverlap` constraint and runtime check.
- **Depends on.** Story B; `schema-prerequisites.md` story 5 (resolver tree with leaf kinds).
- **Tests.** See test plan (C rows).
- **Docs.** `docs/guide/joins.md`, `docs/guide/querying.md`, `docs/guide/relations.md`, `docs/internals/runtime-pipeline.md`. Changeset: `minor` (`Docs: docs/guide/joins.md, docs/guide/querying.md, docs/guide/relations.md, docs/internals/runtime-pipeline.md`).

### Breaking surface

Consumer-facing query API is additive: every existing `join: { relation: true | QueryArgs }` and object `where` keeps working and produces the same rows (SQL text changes only through story 3's aliases). Type exports: `JoinExpressionOf` is removed (replaced by `JoinEntryOf`); `QueryArgs` gains a third defaulted generic. `@dsqlbase/core` internals `SelectOperationArgs.join` and `JoinParams` change shape; anyone driving `OperationsFactory` directly adapts. Each is named in its story's changeset body.

## Test plan

Unit (`packages/core`, `packages/dsqlbase`):

- **A** `normalizer.test.ts`: object and callback `where` produce identical SQL for literals; `self` ref renders with the current alias; `parent` ref renders with the parent alias inside a relation join; `parent` is `undefined` at the root; ref in `eq` / `gt` / `in` / `between` / shorthand; nested `and` / `or` with refs. `client.types.test.ts`: ref of the wrong value type rejected; `parent` typed only in nested levels; `WhereArgOf` accepted on `update` / `delete`.
- **B** `normalizer.test.ts`: filtered relation lowers to the relation target with `AND` over all pairs plus the filter; ad-hoc entry resolves `from` by alias; unknown alias throws; union alias throws; plain-object ad-hoc where throws (uncorrelated); callback that touched no parent field throws; callback that touched one passes; `one` / `many` on the filtered form throws; relation-named ad-hoc key overrides. `operation.test.ts`: `_resolveJoinEntries` consumes `JoinEntry` without registry lookups; correlation AND-ed after the target's where; `mode` per type. `query.test.ts` snapshots: ad-hoc `many`, ad-hoc `one` with `LIMIT 1`, self-join, two ad-hoc entries on the same target at one level, nested ad-hoc inside ad-hoc. `join.types.test.ts` (new): `from` literal drives `where` / `select` / `orderBy` / nested `join`; result shapes `| null` / `[]`; unknown `from` rejected.
- **C** `normalizer.test.ts`: `count` with `select` / `orderBy` / `join` / `limit` throws; `select` relation lowers to `join: { r: { select } }`; `select: { r: true }` lowers to `join: { r: true }`; same relation in both throws. `query.test.ts`: `count` lateral has no wrapper. `operation.test.ts`: scalar resolver yields `number`, no `$$meta` on counts. Type tests: `count` body rejects `select`; result `number`; `select` sugar result equals `join: { r: true }` result; overlap rejected.

e2e (`packages/tests`, PGlite; fixture gains `tasks.parent` self-relation and a composite relation from prerequisite stories 3 / 4):

- **A** column-vs-column at the root (`completedAt > dueDate`) equals the `$query` control; declared relation with a parent-correlated filter returns only matching children.
- **B** `activeMembers` filtered relation equals `findMany` on members with the merged filter; ad-hoc `owner` (`one`) equals the belongs-to relation result on the same fixture; ad-hoc join to a table with no declared relation; self-join `invitedBy` returns the parent's inviter, not itself; two entries on the same target at one level; nested ad-hoc inside a relation join; uncorrelated ad-hoc entry throws before any SQL runs (session spy sees no statement).
- **C** `activeCount` equals `activeMembers.length` for every parent row; `count` of zero returns `0`, not `null`; `select: { members: { id: true } }` equals `join: { members: { select: { id: true } } }` row for row.

Failing tests that expose real bugs stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): new `joins.md` (the three entry forms, `from` = alias, `type` and its default, correlation rule and the error, `count`, self-joins, nested entries, index advice, how tenancy applies inside laterals — cross-link to the tenancy page once it exists); `querying.md` (`where` object or callback, `self` / `parent` refs, value-type matching, refs are not codec-encoded, relations under `select` as field maps, the select/join overlap rule; remove "`join` — declared relations only"); `relations.md` (filtered relations, `select` sugar, one field namespace per table, self-referential relations after story 3).
- **Internals** (`docs/internals/`): `runtime-pipeline.md` (normalizer owns scopes and builds refs; `JoinEntry` lowering — all forms become one shape before the factory; the factory no longer resolves relations; `count` lateral; resolver leaf kinds; remove "Joins are only allowed on declared relations" and the "same table twice … would collide" sentence; update "Selection accepts only real columns" to name relations under `select`; refresh the query-args surface paragraph); `codec-boundary.md` (`ColumnRef` values are references, never encoded; story 7 skips them); `dsql-capabilities.md` (no change — state that the joins topic added no verification item).
- **Decision record**: `docs/decisions/0008-client-runtime-joins.md` on acceptance (after `0007-client-pagination`); this proposal is then deleted.
- **Stale lines**: `QueryArgs.join` JSDoc in `packages/dsqlbase/src/client/model/base.ts` ("based on the relations defined in the schema"); `findOne` / `findMany` JSDoc in `packages/dsqlbase/src/client/model/client.ts`; `docs/guide/querying.md` "`join` — declared relations only"; `.claude/prime/improvements.md` join sketch is superseded (local file, no action). None in `CLAUDE.md`. `packages/dsqlbase/README.md` gains a filtered-relation and a `count` example.
- **Cross-topic notes to carry forward**: the tenancy topic injects in `_resolveSelectParams(target)` and must confirm that the correlation is AND-ed after; the pagination proposal switches `PaginateArgs.where` / `CountArgs.where` to `WhereArgOf`; the embeddables proposal specifies refs to group leaves and joins the story 9 namespace check.
