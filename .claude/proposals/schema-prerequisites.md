---
proposal: schema-prerequisites
status: draft
owner: silviu
created: 2026-09-20
---

# Schema prerequisites: shared runtime work for global ids and polymorphic relations

Extracted from `.claude/proposals/schema-guid.md` (Topic 1), `.claude/proposals/schema-polymorphic-relations.md` (Topic 2) and `.claude/proposals/schema-embeddable-objects.md` (Topic 3). Also consumed by `.claude/proposals/client-pagination.md` (stories 1 and 5), `.claude/proposals/client-runtime-joins.md` (stories 3 as amended, 4, 5 and 9) and `.claude/proposals/client-tenancy.md` (stories 2 and 9). Every story here is needed by at least two of the three features or is a correctness fix they all rely on; none introduces either feature. Implement this proposal first, as one epic (`.claude/epics/schema-prerequisites.md`), then the two feature proposals in either order.

## Problem

Both feature proposals rest on the same runtime deficiencies: the runtime `Table` does not know its primary key or its schema alias, models are attached by duplicated loops, the result resolver has no table context below the top level and no per-row hook, lateral joins reference tables by raw name (self-joins collide), relation joins use only the first column pair, and where-clause values bypass column codecs. Four of these are entries in the gap table of `docs/internals/runtime-pipeline.md`. Per `docs/internals/conventions.md`, gaps are prerequisite stories, not design constraints — so they are collected here once instead of being repeated in two proposals.

Two more items are not gaps but shared surface: the `OnSelectionOf` member-selection type used by `$findByGlobalId` and by union `on:`, and the `$$meta` row contract fixed in Topic 1 and dispatched on in Topic 2. They are included so that both features build on one definition.

## Decision

Nine stories, ordered so that 1–4 are pure gap fixes with no new public API, 5–7 introduce the shared surface, and 8 and 9 are correctness fixes (8 also adds the path lookup Topic 3 needs). Each is one PR with its own changeset and docs update. The features' story lists in the two proposals are rebased on these (see "Effect on the feature proposals").

### Rejected alternatives (one line each)

- **Keep the prerequisites inside each feature proposal** — the same story would be planned twice and whichever feature ships second would either duplicate or silently depend on the first.
- **One big prerequisites PR** — the gap fixes touch `query.ts`, `operation.ts`, `registry.ts`, `table.ts` and the normalizer; separate PRs keep each behaviour change reviewable and bisectable, and each has a distinct changeset note.
- **Fix only what Topic 1 needs and let Topic 2 fix the rest** — Topic 2's blocking gap (join aliasing) is also Topic 1's self-reference case; ordering it first avoids a Topic 1 test that has to be marked as known-broken.

## Stories

All changesets are on the fixed group (`@dsqlbase/core`, `dsqlbase`, `@dsqlbase/migration` version together). Levels are stated per story; the epic's release is `minor`.

### 1. Runtime primary key on `Table`

- **Change.** `Table.primaryKey: AnyColumn[]` (`packages/core/src/runtime/table.ts`), built from column-level `primaryKey` flags plus `PrimaryKeyConstraintDefinition` entries read from `definition["_constraints"]` (the pattern already used for `_namespace`); order = declaration order of the constraint, else column order. `Table.isCompositeKey` derived. Fix the side finding: `PrimaryKeyConstraintDefinition.include()` in `packages/core/src/definition/constraint.ts` assigns `_columns` instead of `_include`.
- **Consumers.** Topic 1: node registry, `$$meta.globalId`, `$findByGlobalId` where-building. Topic 2: union tiebreakers. Client pagination topic: keyset tiebreakers.
- **Tests.** `packages/core/src/runtime/table.test.ts`: flag PK, table-level single PK, composite PK, none; `constraint.test.ts`: `include()` regression.
- **Docs.** `docs/internals/runtime-pipeline.md` ("Primary keys at runtime": composite keys now exposed; remove the gap row). Changeset: `patch` (`Docs: docs/internals/runtime-pipeline.md`).

### 2. `Table.alias` and shared model attachment

- **Change.** `SchemaRegistry._buildTables` (`packages/core/src/runtime/registry.ts`) passes the definition-object key into `new Table(def, relations, alias)`; `Table.alias` defaults to `name` when a `Table` is built directly. `SchemaRegistry.getAlias(nameOrAlias)` and `getTableEntries(): [alias, Table][]` (alias-keyed, no duplicates — `getTables()` today returns both keys). New `attachModels(client, ctx)` in `packages/dsqlbase/src/client/database/base.ts`, used by `packages/dsqlbase/src/client/create.ts` and `packages/dsqlbase/src/client/transaction/transaction-client.ts`, replacing the two duplicated loops; `BaseClient._models: Map<alias, ModelClient>`.
- **Consumers.** Topic 1: global-id keys are aliases; `$findByGlobalId` reaches a model by alias. Topic 2: union member keys, `$$key` literals, `UnionClient` attachment through the same function.
- **Tests.** `registry.test.ts`: alias ≠ name (`members` / `team_members` fixture shape), `getAlias` both directions; `create.test.ts` / `transaction-client.test.ts`: models present under aliases on both clients, one attachment code path.
- **Docs.** `docs/internals/runtime-pipeline.md` (derived-client pattern now goes through `attachModels`; alias/name mapping). Changeset: `patch` (`Docs: docs/internals/runtime-pipeline.md`).

### 3. Table aliasing in lateral joins

- **Change.** Every `FROM` in a select tree gets an alias, unconditionally: `"__t<n>"` per table level and `"__j<n>"` per JSON wrapper (today the wrapper is the fixed `"__t"`). Scopes are owned by the **normalizer**: each level of `RequestNormalizer._getSelectArgs` (`packages/dsqlbase/src/client/model/normalizer.ts`) allocates an opaque `Scope` token carried on `SelectOperationArgs.scope`; `QueryBuilder` (`packages/core/src/runtime/query.ts`) maps token → alias when it renders that level, via a scope stack on `SQLContext`. New `ColumnRef(column, scope)` node in `packages/core/src/sql` renders as `"<alias>"."<column>"`; every column reference produced for a level (`select`, `where`, `orderBy`, join correlations) is a `ColumnRef` of that level's scope, built by the normalizer (user-facing refs, where and order columns) or the operations factory (selection, hidden columns). `Column.toSQL` is **unchanged** (`"table"."column"`), so `$query` users writing `${users.columns.id}` are unaffected; a `ColumnRef` rendered outside any select tree falls back to the same form. The reason the scope must be explicit rather than looked up by table: in a self-join the parent and the inner level are the same `Table` object, so a lookup by table cannot tell `"__t0"."id"` from `"__t1"."id"`.
- **Consumers.** Topic 2: self-referential union members (`ArchiveFolder.entries`) and any join to the parent's own table. Topic 1: the `parentId` self-reference example (`users.parent`). Client runtime joins (`client-runtime-joins.md`): `where` callbacks receive `ColumnRefsOf` proxies of the current and parent scopes; ad-hoc self-joins. Client pagination: hidden `__k<n>` projections reference the root scope. All impossible or wrong today.
- **Tests.** `query.test.ts` SQL snapshots: single table, one join, nested join, **self-join**, same table joined twice at one level, a parent-scope and an inner-scope `ColumnRef` of the same column rendering two aliases; `ColumnRef` fallback outside a select tree; e2e `select.spec.ts`: a `tasks.parent` self-relation added to the fixture.
- **Docs.** `docs/internals/runtime-pipeline.md` (remove the gap row; document scope allocation in the normalizer and alias rendering in the builder; `ColumnRef`), `docs/guide/relations.md` (self-referential relations now supported). Changeset: `minor` — SQL text changes for every select (aliases everywhere); behaviour unchanged except self-joins now work (`Docs: docs/internals/runtime-pipeline.md, docs/guide/relations.md`).

### 4. Composite relation pairs

- **Change.** `_resolveJoinEntries` (`packages/core/src/runtime/operation.ts`) builds the join connection as `sql.and` over every `from[i]` / `to[i]` pair; `SchemaRegistry._buildRelations` validates equal lengths, non-empty, same `dataType` per pair, and that each column belongs to the declared side (Topic 1 later adds the guid-key check on top of this loop).
- **Consumers.** Topic 1: relation pair validation hook. Topic 2: branch predicates over every pair. Client runtime joins: the filtered-relation form (`{ relation, where }`) correlates over every pair. Composite-key tables in general.
- **Tests.** `operation.test.ts` / `query.test.ts`: two-column relation SQL; `registry.test.ts`: length mismatch, type mismatch, wrong-side column each throw with `table.column` names.
- **Docs.** `docs/internals/runtime-pipeline.md` (remove the gap row), `docs/guide/relations.md` (drop "for future composite support"; document composite pairs). Changeset: `minor` — schemas with mismatched pairs that silently worked on `[0]` now fail at `createClient` (`Docs: docs/internals/runtime-pipeline.md, docs/guide/relations.md`).

### 5. `$$meta`, `table().meta()`, and the row-aware resolver

- **Change.** `TableDefinition.meta<M>(m)` (`packages/core/src/definition/table.ts`; `TableConfig.meta`, excluded from `toJSON`); `Table.meta` frozen `{ key: alias, table: name, schema?, ...definition.meta }`; `$$meta` and `$$key` rejected as field aliases at `Table` build. Resolver tree in `packages/core/src/runtime/operation.ts` changes from `FieldResolver = [field, AnyColumn | FieldResolver[]]` to a node type `{ table, fields, post? }` per level, where `post` is an ordered list of **row-aware post-processors** `(row, raw, table) => void` run after column resolution — `raw` is the driver row before codec decoding, because consumers that need the database's own text representation (keyset cursors) cannot rebuild it from decoded values; `_createResultResolver` stamps `$$meta` at every level (top-level, join, `return`) as an enumerable property whose shared part is the frozen table meta. Topic 1 registers a `globalId` post-processor; Topic 2 registers union dispatch and dynamic-key wrapping. Types: `TableDefinition` / `Table` gain a trailing `TMeta` generic with a default; `RecordMetaOf<TTable> = { key; table; schema? } & TMeta`; `QueryResultOf`, `RelationJoinResultOf`, `ReturningResultOf` (`packages/dsqlbase/src/client/model/base.ts`) add `$$meta`.
- **Consumers.** Topic 1: `$$meta.key` discriminant, `globalId`. Topic 2: per-row dispatch, `__typename` for interfaces and unions. Client pagination (`client-pagination.md`): `$$meta.cursor` stamped from the raw row's hidden `__k<n>` columns.
- **Tests.** `operation.test.ts`: `$$meta` at each level, shared part frozen, post-processor order, reserved aliases; type tests in `client.types.test.ts` for `$$meta` on all result shapes; e2e: `$$meta` present on nested join rows and `return` rows.
- **Docs.** `docs/guide/querying.md` (`$$meta` on every row), `docs/guide/schema.md` (`table().meta()`, reserved aliases), `docs/internals/runtime-pipeline.md` (resolver tree shape, post-processors). Changeset: `minor` — result rows gain a property; consumer `toEqual` assertions on whole rows break (`Docs: docs/guide/querying.md, docs/guide/schema.md, docs/internals/runtime-pipeline.md`).

### 6. `OnSelectionOf` member-selection type

- **Change.** `OnSelectionOf<TMembers extends Record<string, AnyTableDefinition>, TSchema> = { [K in keyof TMembers]?: Pick<QueryArgs<TableOf<TMembers[K]>, TSchema>, "select" | "where" | "join"> | boolean }` and `OnResultOf<TMembers, TSchema, TOn>` (union over non-excluded members of the per-member `QueryResultOf` with `$$meta`) in `packages/dsqlbase/src/client/model/base.ts`, plus a runtime helper `resolveOnSelection(members, on)` in the normalizer that returns the included aliases with their normalized `QueryArgs` (omitted → all members with no args; `true` → no args; `false` → excluded). No consumer in this story; type-only plus the helper.
- **Consumers.** Topic 1: `$findByGlobalId(id, on)` / `$listByGlobalId(ids, on)`. Topic 2: union `on:`.
- **Tests.** Type tests (`on.types.test.ts`): key narrowing, `false` removes a member from the result union, per-member select applied; unit test for `resolveOnSelection`.
- **Docs.** `docs/guide/querying.md` (the `on` map, described once and linked from both feature pages later). Changeset: `patch` (`Docs: docs/guide/querying.md`).

### 7. Codec-aware where clauses

- **Change.** `Column.param(value): SQLParam` (`packages/core/src/runtime/column.ts`) builds `new SQLParam(value, codec.encode)`; `packages/dsqlbase/src/client/model/normalizer.ts` routes `eq / neq / gt / gte / lt / lte / in / between` and the value shorthand through it for `where`, `update.where`, `delete.where`; `beginsWith / endsWith / contains` stay raw patterns (documented). `sql.eq(column, value)` is unchanged (raw), as `docs/internals/codec-boundary.md` records for `$query`. A value that is already an `SQLNode` — in particular a `ColumnRef` from story 3 (`client-runtime-joins.md`) — is passed through untouched, never encoded.
- **Consumers.** Topic 1: wrapped ids in filters. Topic 2: shared `where` per member column, discriminator expansion. Date, bigint and interval filters today (behaviour change: values are codec-encoded instead of driver-serialized — e2e must show identical results).
- **Tests.** Normalizer unit tests per operator and shorthand, pattern operators untouched; e2e filter tests for `date`, `datetime`, `bigint`, `duration` columns in the fixture (each exercising `eq`, `in`, `between`).
- **Docs.** `docs/internals/codec-boundary.md` (move where values from "does NOT apply" to "applies"; `Column.param` for raw SQL), `docs/internals/runtime-pipeline.md` (remove the gap row), `docs/guide/querying.md` (filters accept JS values for every codec column). Changeset: `minor` — wire format of filter values changes for codec columns (`Docs: docs/internals/codec-boundary.md, docs/internals/runtime-pipeline.md, docs/guide/querying.md`).

### 8. Duplicate DB column names and path lookup on `Table`

- **Change.** `TableDefinition` constructor and `Table._buildColumns` (`packages/core/src/runtime/table.ts`) throw when two fields map to the same DB column name (today the second silently shadows the first in `getColumn(name)` and migrations emit invalid DDL). New migration rule `duplicateColumnName` (`DUPLICATE_COLUMN_NAME`) in `packages/migration/src/validation/rules/table.ts`. `Table.getColumn` accepts a dotted alias path in addition to an alias or a DB name (a no-op for flat tables; Topic 3 keys group members by path).
- **Consumers.** Topic 3: flattened groups make collisions likely and need the path lookup. Topics 1 and 2: none directly; the check is a correctness fix owed regardless.
- **Tests.** `table.test.ts` (definition and runtime): duplicate name throws with both aliases named; migration rule test; `getColumn` by path.
- **Docs.** `docs/guide/schema.md` (column names must be unique per table), `docs/internals/migration-pipeline.md` (new rule). Changeset: `minor` — schemas that relied on silent shadowing now fail at definition time (`Docs: docs/guide/schema.md, docs/internals/migration-pipeline.md`).

### 9. One field namespace per table

- **Change.** `SchemaRegistry._buildTables` (`packages/core/src/runtime/registry.ts`) throws when a relation name equals a column alias on the same table, naming both (`Relation "members" on table "workspaces" collides with column "members"`). Columns, relations and — when `schema-embeddable-objects.md` lands — embeddable group names all draw from one namespace, because the client addresses them all as fields of one model (`select`, `join`, result keys). Today nothing checks this and `QueryResultOf` would intersect the two types.
- **Consumers.** Client runtime joins: relations under `select` are told apart from columns and groups by name alone. Topic 3 (embeddables): group names join the same check. Correctness fix owed regardless.
- **Tests.** `registry.test.ts`: relation named like a column throws with both names; relation named like a column of a *different* table passes.
- **Docs.** `docs/guide/relations.md`, `docs/guide/schema.md` (field names are unique per table across columns and relations). Changeset: `minor` — schemas with a colliding relation name now fail at `createClient` (`Docs: docs/guide/relations.md, docs/guide/schema.md`).

## Effect on the feature proposals

- `schema-guid.md`: stories 1, 2, 3, 5 move here (as 1, 2, 5, 7); its remaining stories are **4** (node registry, `guid()` marker, `$findByGlobalId` / `$listByGlobalId`, helpers — G) and **6** (guid codec + relation validation — A), plus the relation-pair validation is now an extension of story 4 here.
- `schema-polymorphic-relations.md`: its story 0 is this proposal; its stories 1–5 are unchanged.
- `schema-embeddable-objects.md`: depends on stories 5, 7 and 8; its five stories are unchanged.
- `client-pagination.md`: depends on stories 1 and 5 (story 5's post-processor signature carries the raw row for this reason); story 3 changes its column references but not its design; story 7 is not required because cursors bypass codecs.
- `client-runtime-joins.md`: depends on stories 3 (amended above: unconditional aliasing, normalizer-owned scopes, `ColumnRef`), 4, 5 and 9; story 7 must pass `ColumnRef` values through unencoded.
- `client-tenancy.md`: depends on story 2 (`attachModels` builds the identity client) and story 9 (a claim field is a field, so it may not collide with a relation name); story 7 is not required because the tenant predicate is encoded in core.
- The two proposals keep their own decision records; this one is recorded as a single entry that closes four gap rows.

## Breaking surface

Stories 3, 4, 5, 7, 8 and 9 change observable behaviour (SQL text with aliases, stricter relation validation, `$$meta` on rows, encoded filter values, duplicate column names rejected, colliding relation names rejected). Each is `minor` with the change named in its changeset body. Stories 1, 2 and 6 are additive (`patch`).

## Test plan

Per story above. Cross-cutting: the PGlite fixture (`packages/tests/src/db/schema/schema.ts`) gains a self-relation (`tasks.parent`) and a two-column relation (`members` ↔ a composite-keyed table added for the purpose) so stories 3 and 4 are exercised end to end; every existing e2e spec must pass unchanged except for `$$meta` appearing on rows, which the specs assert explicitly rather than by whole-row equality. Failing tests that expose real bugs stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): `querying.md` (`$$meta`, `on` map, codec-aware filters), `schema.md` (`table().meta()`, reserved aliases `$$meta` / `$$key`, unique column names, one field namespace per table), `relations.md` (composite pairs, self-referential relations, relation names may not collide with columns).
- **Internals** (`docs/internals/`): `migration-pipeline.md` (duplicate column rule); `runtime-pipeline.md` (four gap rows removed: composite PK, first-column-only joins, no table aliasing, codec not applied to where; new sections on scope allocation in the normalizer and alias rendering in the builder, `ColumnRef`, resolver tree and post-processors, `attachModels`), `codec-boundary.md` (where values now encoded; `Column.param`).
- **Decision record**: `docs/decisions/0003-schema-prerequisites.md` on acceptance (renumbering Topic 1's to `0004` and Topic 2's to `0005`); this proposal is then deleted and the epic records what shipped.
- **Stale lines**: none in `CLAUDE.md`; `packages/dsqlbase/README.md` relations example gains nothing until the feature proposals land.
