---
proposal: schema-embeddable-objects
status: draft
owner: silviu
created: 2026-09-20
---

# Embeddable objects: flattened column groups (`object()`) and typed `jsonb` documents

Prime: `.claude/prime/02-schema.md` Topic 3. Review context: `.claude/prime/00-review.md`, `docs/internals/runtime-pipeline.md`, `docs/internals/codec-boundary.md`, `docs/internals/migration-pipeline.md`. Depends on `.claude/proposals/schema-prerequisites.md` (resolver post-processors, codec-aware where, duplicate column-name validation, path lookup).

## Problem

The API layer wants reusable object types (`Money`, `Address`) on models without polluting the GraphQL schema with prefixed scalars, and the database side wants those objects filterable, orderable and indexable per field. Separately, document-like fields (settings, preferences) want a typed, validated JSON column with idiomatic JSON filters. Today every non-model object-typed field reaches the database as an untyped `json` column.

### Consumer stack (verified 2026-09-20)

- gqlbase `DsqlBaseSchemaGeneratorPlugin._generateColumn` emits `json("<name>").$type<TypeName>()` for every field whose type is a non-model object type, and for every list. There is no way to ask for flattened storage; there is no `jsonb`.
- DSQL (`docs/internals/dsql-capabilities.md`, re-verified today against the supported-SQL page): `json` and `jsonb` are supported types; `CREATE INDEX ASYNC` keys "can be column names or expressions"; the supported DDL list contains `CREATE DOMAIN` but **not `CREATE TYPE`** — composite types are unavailable; `DROP COLUMN` and `ADD CONSTRAINT CHECK … NOT VALID` are supported (the migration module refuses them; stale rows in the capability table).

### What the code does today (verified)

- `table(name, columns)` (`packages/dsqlbase/src/schema/table.ts`) takes a flat `Record<string, ColumnDefinition>`; `TableDefinition.columns` (`packages/core/src/definition/table.ts`) feeds both `Table._buildColumns` (`packages/core/src/runtime/table.ts`) and migration `toJSON`. A group must therefore expand into real `ColumnDefinition`s to get runtime columns and migrations for free.
- `json()` (`packages/dsqlbase/src/schema/columns/json.ts`) is `ColumnConfig<unknown, string>` with `JSON.stringify` / `safeParseJson`; `$type<T>()` is a cast, nothing validates. There is no `jsonb()`.
- The read resolver (`_createResultResolver`, `packages/core/src/runtime/operation.ts`) already walks nested resolver trees; `_resolveFields` accepts real columns only. The normalizer (`packages/dsqlbase/src/client/model/normalizer.ts`) resolves `select` / `where` / `orderBy` / mutation fields with `table.getColumn(fieldName)` — flat names only. `FieldSelectionOf`, `WhereExpressionOf`, `OrderByExpressionOf`, `CreateValuesOf`, `UpdateValuesOf` (`packages/dsqlbase/src/client/model/base.ts`) have no nested paths.
- `ColumnRefs` (`definition/table.ts`) and `IndexDefinition.columns` / `include` (`packages/core/src/definition/indexes.ts`) are flat maps over `table.columns`.
- No rule catches two aliases mapping to the same DB column name — neither `Table._buildColumns` nor `packages/migration/src/validation/rules/table.ts` (`unknownColumnReference` builds a `Set` of names but nothing checks its size). Flattening makes that collision likely.
- `$enum(name, values).column("status")` and `domain.column()` are the existing "reusable definition → column instance" pattern; `object()` follows it.

## Decisions taken during grilling

| # | Question | Decision |
|---|---|---|
| 1 | Scope | **Both, two builders**: `object({...})` for value objects flattened into real columns; `jsonb(name)` for documents. Not one builder with a storage flag (rejected below). |
| 2 | Nesting | **Nested groups allowed** (a member may be a group; DB names chain prefixes). Arrays of objects stay `jsonb`. |
| 3 | Nullability | **Two levels, the user's form**: members declare their own nullability in the shape; the group column declares presence with `.notNull()`. `money.column("net_value").notNull()`. The DB nullability and an integrity CHECK are derived (rules below). |
| 4 | Writes | `create` requires the group when it is `.notNull()` and, inside it, the members that are `.notNull()`; `update` with a partial object is **member-wise**; `null` on a nullable group nulls every member. |
| 5 | Naming | Leaf DB name is `<groupColumn>_<memberName>`, chained for nested groups (`address_geo_lat`). |
| 6 | Selection | `select: { netValue: true }` selects every member; `select: { netValue: { amount: true } }` selects some. |
| 7 | Collisions | Duplicate leaf DB names are rejected at `Table` build and by a new migration rule — a missing check regardless of groups, so it is prerequisite story 8. |
| 8 | Consumer follow-up | gqlbase picks the storage per non-model type with a directive (flattened `object()` or `jsonb()`); the default replaces today's `json` with `jsonb`. External, not a dsqlbase story. |

## Decision

**Option A — column-group flattening — for value objects, plus Option B — typed `jsonb` — for documents, as two builders sharing nothing but the docs page.**

`object({...})` is a reusable *shape*; `shape.column(name)` is a *group column* placed in a table like any other column. The table keeps the declared shape for types and the client API, and exposes flattened leaf columns to the runtime and to migration serialization, so SQL, indexes, constraints and migrations work on ordinary columns while the client reads and writes nested objects. `jsonb(name)` is a plain column with a JSON codec, an optional validator, and containment filters.

### Rejected options (one line each)

- **C. One builder — `object()` is JSON, `.flatten()` switches storage** (the `improvements.md` idea) — the two storages differ in filter shape (`@>` / `->>` vs typed columns), nullability (one nullable value vs two levels), indexing (expression index vs plain), and migration (no-op vs DDL); one signature would have to `never` half its API depending on a flag.
- **D. DB composite type (`CREATE TYPE … AS (…)`)** — absent from DSQL's supported DDL (verified today).
- **E. Hand-prefixed columns + resolver reshaping** (status quo) — the object shape leaks into every resolver; nothing is reusable; `where` on members stays flat.
- **B as the value-object mechanism** — no typed `orderBy`, a cast on every comparison, one expression index per queried path.
- **Nullability form (b): `money("net_value")` factory call + `.atomic()` flag** — nullability in one place needs an extra flag for integrity, and all-or-none is wrong for optional members.
- **Nullability form (c): members only, group never `null`** — a missing address reads as an object of nulls; no way to express "the whole object is optional".

## API

### Schema side — Option A

```ts
import { object, table, text, bigint, guid, $enum, jsonb } from "dsqlbase/schema";

export const currency = $enum("currency", ["EUR", "USD", "RON"]);

export const money = object({
  amount: bigint("amount").notNull(),           // member nullability
  currency: currency.column("currency").notNull(),
});

export const geo = object({ lat: numeric("lat"), lng: numeric("lng") });

export const address = object({
  line1: text("line1").notNull(),
  city: text("city").notNull(),
  geo: geo.column("geo"),                       // nested group → address_geo_lat, address_geo_lng
});

export const invoices = table("invoices", {
  id: guid("id").primaryKey().defaultRandom(),
  netValue: money.column("net_value").notNull(),           // net_value_amount NOT NULL, net_value_currency NOT NULL
  discount: money.column("discount"),                      // discount_amount, discount_currency nullable + CHECK (see rules)
  billing: address.column("billing").default({ line1: "-", city: "-" }),
  settings: jsonb("settings").$type<InvoiceSettings>(),   // Option B
});

invoices.index("invoices_net_value_idx").columns((c) => [c.netValue.amount]);
invoices.check((c) => sql`${c.netValue.amount} >= 0`);
```

Derived rules, applied when the table is defined (`TableDefinition`) and re-checked when the runtime `Table` is built:

- **Leaf nullability.** A leaf is `NOT NULL` iff its group column is `.notNull()` (transitively, every enclosing group) **and** the member is `.notNull()`.
- **Integrity CHECK.** For a nullable group that has at least one `.notNull()` member, the table gets `CHECK ((<every leaf> IS NULL) OR (<every required leaf> IS NOT NULL))`, named `<table>_<group>_check`: a stored group is either absent or complete. A `.notNull()` group needs none (its required leaves are `NOT NULL`). A nullable group with only optional members gets none, and an all-null object reads back as `null` (documented edge).
- **Defaults.** `shape.column(name).default(obj)` is sugar: it sets member defaults from `obj` (encoded through each member's codec); members may also carry their own `default()` / `$onCreate` / `$onUpdate`, which apply unchanged.
- **Reserved.** A group's leaf names must not collide with other leaves or plain columns (prerequisite story 8); `$$meta` / `$$key` remain reserved aliases at every level.
- **Constraints on members.** `primaryKey()` / `unique()` on a member are not allowed inside a shape (a shape is reusable; keys belong to the table); table-level `unique((c) => [c.netValue.currency])` and `index().columns((c) => [c.billing.geo.lat])` work through nested refs.

### Schema side — Option B

```ts
export const preferences = jsonb("preferences")
  .$type<Preferences>()                          // cast only
  .schema(preferencesSchema);                    // optional Standard Schema validator: runs on encode and decode
```

`.schema()` accepts any object implementing Standard Schema (`~standard.validate`), so zod / valibot / arktype are optional peers, never dependencies. Validation failure throws `ColumnValidationError` naming the column and the issues. `json()` stays as is (deprecated in docs in favour of `jsonb()`).

### Client side

```ts
const invoice = await dsql.invoices.findOne({
  where: {
    netValue: { amount: { gt: 100n }, currency: { eq: "EUR" } },   // nested → leaf columns, codec-aware
    discount: { exists: false },                                    // group-level: every leaf IS NULL
    billing: { geo: { lat: { between: [44, 45] } } },               // nested group
    settings: { contains: { theme: "dark" } },                      // jsonb @>
  },
  select: { id: true, netValue: true, billing: { city: true, geo: true } },
  orderBy: { netValue: { amount: "desc" } },
});
invoice.netValue;              // { amount: 120n, currency: "EUR" }
invoice.discount;              // null when every leaf is NULL; otherwise { amount, currency }
invoice.billing;               // { city: "…", geo: { lat, lng } | null }

await dsql.invoices.create({ data: { netValue: { amount: 10n, currency: "EUR" } } });      // required: group + its required members
await dsql.invoices.update({ where: { id }, data: { netValue: { amount: 11n } } });        // member-wise: only net_value_amount
await dsql.invoices.update({ where: { id }, data: { discount: null } });                  // every discount_* leaf = NULL
await dsql.invoices.update({ where: { id }, data: { netValue: null } });                  // type error: group is notNull
```

Group-level filters: `exists: true | false` (any leaf `IS NOT NULL` / every leaf `IS NULL`); nothing else at group level — comparisons are per member. `orderBy` on a group name is a type error; on a member it is the leaf column.

### SQL

Nothing new: leaf columns are ordinary columns, so selects, `WHERE`, `ORDER BY`, `RETURNING`, indexes and constraints are unchanged. The only JSON-specific SQL is Option B's `"settings" @> $1::jsonb` and `"settings" ? $1` (`hasKey`).

## Runtime design

| File | Change |
|---|---|
| `packages/core/src/definition/base.ts` | `Kind.OBJECT` (shape) and `Kind.OBJECT_COLUMN` (group column). |
| `packages/core/src/definition/object.ts` (new) | `ObjectDefinition<TShape>` with `column(name)`; `ObjectColumnDefinition<TName, TShape, TConfig>` with `notNull()`, `default(obj)`, `$onCreate` / `$onUpdate` for the whole object, and `leaves(prefix?)`: the flattened `[path[], leafName, ColumnDefinition]` list with derived nullability (a clone of each member definition with `_notNull` recomputed and the name prefixed; the member's codec, domain, check, generated and identity settings are carried). Shapes are immutable and reusable; `.column()` produces an independent instance. `AnyTableColumnDefinition = AnyColumnDefinition \| AnyObjectColumnDefinition`. |
| `packages/core/src/definition/table.ts` | `TableConfig.columns: Record<string, AnyTableColumnDefinition>`; `leafColumns()` (flattened, cached) used by `toJSON` (columns) and by `_getColumnRefs` (nested `ColumnRefs`: a group key maps to an object of refs); derived integrity CHECKs appended to `_constraints` at construction; `check` / `unique` / `primaryKey` / `index` callbacks receive nested refs. |
| `packages/core/src/definition/indexes.ts` | `ColumnConfigRefs` nested like `ColumnRefs`; `IndexColumnDefinition` takes leaf definitions (unchanged otherwise). |
| `packages/core/src/definition/column.ts` | `ColumnValidationError`; `ColumnConfig.validator?: StandardSchemaV1` (core owns the hook; the `jsonb` builder sets it). |
| `packages/core/src/runtime/table.ts` | `columns` keyed by **path** (`"netValue.amount"`) plus `groups: Record<path, ColumnGroup { name, notNull, members: (leaf path \| group)[], required: leaf paths }>`; `getColumn(pathOrName)` resolves a dotted alias path or a DB leaf name (prerequisite story 8 adds the path lookup and the duplicate-name check); `getGroup(path)`. |
| `packages/core/src/runtime/operation.ts` | `_resolveFields`: a group selection becomes a nested resolver node `{ group, fields }` (the tree from prerequisite story 5); a `true` selection expands to all leaves. Post-processor per nullable group: if every selected leaf is `null`, set the field to `null` (nested groups inside out). `_resolveInsertEntries` / `_resolveUpdateEntries` receive already-flattened `FieldMutation`s (path-keyed) and look up leaves by path; `null` for a group is expanded by the normalizer. |
| `packages/dsqlbase/src/schema/object.ts` (new) | `object(shape)` → `ObjectDefinition`; exported from `packages/dsqlbase/src/schema/index.ts`. |
| `packages/dsqlbase/src/schema/columns/jsonb.ts` (new) | `jsonb(name)` → `ColumnDefinition<TName, ColumnConfig<unknown, string>>` with `dataType: "jsonb"`, JSON codec, `.schema(validator)`; `json.ts` unchanged. |
| `packages/dsqlbase/src/client/model/normalizer.ts` | `_getSelectionEntries`, `_getWhereExpression`, `_getOrderByEntries`, `_getMutationEntries` and the insert path walk nested objects: a key that names a group recurses with the path prefix; `exists` at group level expands to `AND` / `OR` over leaves; a `null` group value expands to one `null` per leaf; jsonb `contains` → `sql\`${column} @> ${sql.param(JSON.stringify(v))}::jsonb\``, `hasKey` → `?`. |
| `packages/dsqlbase/src/client/model/base.ts` | Types below. |
| `packages/migration/src/validation/rules/table.ts` | `duplicateColumnName` rule (prerequisite story 8). Nothing else: `toJSON` already yields flat columns and a plain CHECK constraint. |

## Type design

- `ObjectDefinition<TShape extends Record<string, AnyColumnDefinition | AnyObjectColumnDefinition>>`; `ObjectColumnDefinition<TName, TShape, TConfig extends { notNull: boolean; hasDefault: boolean }>`, with `__type.valueType = ObjectValueOf<TShape>` = `{ [K in keyof TShape]: ValueTypeOf<TShape[K]> }` where a nested group contributes `ObjectValueOf<…> | null` unless `.notNull()`.
- `FieldNamesOf<T>` stays the top-level keys; new `GroupFieldNamesOf<T>`. `ValueTypeOf` for a group applies `| null` when the group is not `.notNull()`.
- `FieldSelectionOf<T>`: a group key accepts `boolean | NestedSelectionOf<Shape>`; `SelectionResultOf` maps `true` to the whole object type and a nested selection to a `Pick`-like object, preserving the group's `| null`.
- `WhereExpressionOf<T>`: a group key accepts `{ exists?: boolean } & { [member]?: FilterOf<member> | nested }`; `OrderByExpressionOf<T>`: a group key accepts a nested order object (no direction at group level).
- `CreateValuesOf<T>`: a `.notNull()` group without a default is required; its value type requires `.notNull()` members without defaults and makes the rest optional; a nullable group is optional and accepts `null`. `UpdateValuesOf<T>`: deep-partial per group; `null` accepted only for nullable groups.
- Option B: `jsonb` `valueType` is `unknown` until `$type<T>()`; `.schema(s)` infers `T` from `StandardSchemaV1.InferOutput<S>` when `$type` was not called. `contains` accepts `DeepPartial<T>`.
- Type tests in `packages/dsqlbase/src/client/model/client.types.test.ts` plus new `object.types.test.ts`.

## Migration impact

- Option A produces ordinary columns and ordinary CHECK constraints; snapshots, diffs and validation see no new node kinds. Consequences to document: changing a reused shape changes every table that uses it (add / drop leaf columns — `DROP COLUMN` is supported by DSQL, refused by the module today: that stale rule is a migration-topic item and until it lands a dropped member is reported, not executed); renaming a member is add + drop, not a rename; toggling `.notNull()` on a group flips leaf nullability (`DROP NOT NULL` is supported, `SET NOT NULL` is not — a group can become nullable, not the reverse, without recreate) and adds/removes the derived CHECK (`NOT VALID` + validate path, also refused today).
- Option B: `jsonb` is a new `dataType` string; no module change. Expression indexes over JSON paths need `IndexDefinition` expression support — migration topic, listed as a follow-up.

## Failure modes

| Input | Behaviour |
|---|---|
| Two leaves (or a leaf and a column) with the same DB name | throws at `table()` and at `Table` build; migration rule `DUPLICATE_COLUMN_NAME` |
| `primaryKey()` / `unique()` on a shape member | throws at `object()` |
| A shape containing itself (cycle) | throws at `object()` |
| `select` / `where` / `orderBy` naming a non-member under a group; `orderBy: { netValue: "asc" }` | type error; runtime throws |
| `create` missing a `.notNull()` group or a required member | type error; database `NOT NULL` violation if forced |
| `update` with `null` on a `.notNull()` group | type error; runtime throws |
| Partial object stored in a nullable group with required members (raw SQL) | rejected by the derived CHECK |
| Nullable group with only optional members, all `null` | reads as `null` (documented) |
| `jsonb` value failing `.schema()` on write or read | `ColumnValidationError` |
| `contains` on a non-jsonb column | type error; runtime throws |

## Stories, ordering, changesets

After `.claude/proposals/schema-prerequisites.md` (stories 5, 7, 8 are the direct dependencies). All `minor` on the fixed group; each story names its docs pages and is not done until they are updated in the same PR.

1. **`object()` shape and group column definitions, flattening, derived nullability and CHECK, nested refs.** `definition/object.ts`, `table.ts` (`leafColumns`, nested `ColumnRefs`, derived constraints), `indexes.ts`, `schema/object.ts`; migration `toJSON` snapshot tests proving flat output. Docs: `docs/guide/schema.md`, `docs/internals/migration-pipeline.md` (flattening happens before serialization).
2. **Runtime groups: path-keyed columns, nested select and result shaping.** `runtime/table.ts` groups, `operation.ts` nested resolver node + nullable-group post-processor, normalizer `select`; types for selection and results. Docs: new `docs/guide/embeddable-objects.md`, `docs/guide/querying.md`, `docs/internals/runtime-pipeline.md`.
3. **Nested where and orderBy, group `exists`.** Normalizer + types. Docs: `docs/guide/querying.md`, `docs/guide/embeddable-objects.md`.
4. **Nested create and member-wise update, group `null`, group defaults.** Normalizer mutation paths, `CreateValuesOf` / `UpdateValuesOf`. Docs: `docs/guide/embeddable-objects.md`, `docs/guide/querying.md`.
5. **`jsonb()` with validator hook and containment filters.** `columns/jsonb.ts`, `ColumnConfig.validator`, `ColumnValidationError`, `contains` / `hasKey`. Docs: `docs/guide/schema.md`, `docs/guide/querying.md`, `docs/internals/codec-boundary.md` (validation runs inside the codec).

Follow-ups (not stories here): expression and partial indexes in `IndexDefinition` (migration topic) for JSON paths; path filters with casts on `jsonb`; gqlbase directive selecting `object()` vs `jsonb()` and the `json` → `jsonb` default.

### Breaking surface

- `TableConfig.columns` / `TableDefinition.columns` value type widens to include group columns; `ColumnRefs` and index/constraint callback arguments become nested for tables with groups (unchanged for tables without).
- Runtime `Table.columns` keys become paths (identical to today for flat tables).
- `FieldSelectionOf` / `WhereExpressionOf` / `OrderByExpressionOf` / `CreateValuesOf` / `UpdateValuesOf` gain nested branches (additive).
- New reserved behaviour: duplicate DB column names throw (prerequisite story 8; today they silently produce invalid DDL).

Level: `minor`, each named in the changeset body with a `Docs:` line.

## Test plan

- **core unit** (`packages/core/src`): `object.test.ts` (shape reuse, `.column()` independence, nested flattening names, derived nullability matrix — 4 combinations, derived CHECK text, no CHECK for `.notNull()` groups or all-optional groups, member `primaryKey` rejected, cycle rejected, group `default` fan-out); `table.test.ts` (`leafColumns`, `toJSON` flat output and constraint, nested refs in `check` / `unique` / `index`, duplicate leaf name); `runtime/table.test.ts` (path keys, `getColumn` by path and by leaf name, groups map); `operation.test.ts` (nested resolver output, nullable group → `null`, nested group inside out, `return` on insert with a group).
- **dsqlbase unit** (`packages/dsqlbase/src`): normalizer nested `select` (`true`, partial, nested), `where` per member with codec (`bigint` amount), group `exists` expansion, nested `orderBy`, insert flattening, update member-wise, group `null` expansion, `jsonb` `contains` / `hasKey` SQL, validator pass / fail on encode and decode; type tests for value types with both nullability levels, selection results, `CreateValuesOf` required members, `UpdateValuesOf` deep partial, `null` rejected on `.notNull()` groups, `contains` typed from `$type` / `.schema`.
- **e2e, PGlite** (`packages/tests/src/specs`): extend `db/schema/schema.ts` with `money` / `address` shapes on `projects` (a `.notNull()` group and a nullable group with a required member, one nested group) and a `jsonb` column; new `embeddable.spec.ts`: migration creates flat columns and the CHECK; create / read round trip; nullable group reads `null`; partial null rejected by the CHECK through `$query`; filter and order by member; group `exists`; member-wise update; group `null` update; index on a member is used (`EXPLAIN` contains the index name); `jsonb` round trip, `contains`, validator error. Failing tests that expose real bugs stay failing (`docs/internals/testing.md`).

## Docs

- **Guide** (`docs/guide/`): new `embeddable-objects.md` (shapes, group columns, two-level nullability with the derived rules and the all-optional edge, naming, nested select / where / orderBy / create / update, indexes and constraints on members, migration consequences of changing a shape, `jsonb` documents with validator and `contains`); `schema.md` (`object()`, `jsonb()`, `json()` deprecated note, reserved names); `querying.md` (nested paths, group `exists`, `contains` / `hasKey`); `migrations.md` (shape changes are column add / drop; the derived CHECK).
- **Internals** (`docs/internals/`): `runtime-pipeline.md` (path-keyed columns, group resolver node and post-processor, normalizer nested walk); `codec-boundary.md` (member codecs apply per leaf; validator inside the jsonb codec); `migration-pipeline.md` (flattening precedes serialization; no new node kinds); `dsql-capabilities.md` (add the verified line: `CREATE TYPE` not in the supported DDL list; index keys may be expressions — `Verified:` date bump); `architecture.md` (new files).
- **Decision record**: `docs/decisions/0006-embeddable-objects.md` on acceptance (after `0003` prerequisites, `0004` global ids, `0005` polymorphic relations); this proposal is then deleted.
- **Stale lines**: root `README.md` showcase (`json` example → `jsonb`); `packages/dsqlbase/README.md` column list.
- **Cross-topic notes**: the migration topic owns `DROP COLUMN`, `NOT VALID` CHECK and expression-index support that this feature's consequences rely on; the resolver post-processor and path lookup come from `schema-prerequisites.md` (stories 5, 8); the client pagination topic may order by a group member (a leaf column — no special case).
