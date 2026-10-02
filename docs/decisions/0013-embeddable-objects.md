# 0013 — Embedded objects as column groups

- **Date:** 2026-10-02
- **Status:** accepted
- **Proposal:** `schema-embeddable-objects.md` (local working artifact, not tracked)
- **Builds on:** [0011](./0011-json-columns.md) — its "Embeddable objects" review notes and the
  reserved nested `where`

## Context

The API layer wants reusable value objects — `Money`, `Address` — on models without prefixed
scalars, and the database wants their members filterable, orderable and indexable. Documents
already had `jsonb()` with `.schema()` ([0011](./0011-json-columns.md),
[0012](./0012-json-array-record.md)), but DSQL cannot index `jsonb`, and it has no `CREATE TYPE`,
so a value object that is queried by its members has to be real columns.

The first draft was parked on 2026-10-01 with open points. It re-keyed `Table.columns` by dotted
path, derived a two-level nullability enforced by a CHECK, and filtered members directly under
the group key. The re-draft settled each.

## Decision

### A tree, at both levels

- **`embedded({...})`** (`EmbeddedObjectDefinition`, `Kind.EMBEDDED_OBJECT`) holds member
  columns — or groups — and is never placed in a table itself.
- **`.column(name)`** returns a `ColumnGroupDefinition` (`Kind.COLUMN_GROUP`) holding its own
  **copies** of the members, renamed `<name>_<member>` and chained for nested groups. A copy
  shares nothing mutable: an identity config is copied, and a member's `.check()` is rebuilt
  against the new name, an explicit check name prefixed with the group's.
- **A table's `columns` takes columns or groups.** The runtime builds a `Column` or a
  `ColumnGroup` per entry. References follow the tree:
  `invoices.columns.netValue.columns.amount` on the definition, `c.netValue.amount` in `check`,
  `unique`, `primaryKey` and `index` callbacks (each group has its own `_getColumnRefs`), and
  `table.getColumn("netValue")` then `group.getColumn("amount")` at runtime. **No dotted path
  strings** — the deferred half of prerequisites story 8 (`getColumn` by dotted path) is closed.
- Members serialize as plain columns, so migrations see no new node kinds.

### Nullability is the members'

- A group has no `.notNull()`. A member's `.notNull()` is its column's `NOT NULL`.
- A group is nullable when every member, nested groups included, is nullable, and is `null`
  exactly when every one of its columns is `NULL`.
- The database enforces completeness, so there is **no derived CHECK** and no client-side
  completeness check.

### The group owns how it is read

- `ColumnGroup.reader(selection)` returns the columns to project and a `resolve(row)`, which
  `_resolveFields` pushes as a `MetaResolver`, so no resolver kind was added. A nullable group
  projects all of its columns whatever the selection names, because only all of them can tell
  an absent group from one whose selected members happen to be `NULL`. It emits only the
  selected members.
- `ColumnGroup.exists(present)` is the filter for the same rule, so a filter and a read never
  disagree.

### One filter grammar for nested values

- A group's filter takes `exists` and the **nested `where`** reserved by `0011`. Members are
  named only inside `where`, never beside `exists`, so a member called `exists` or `eq` cannot
  be mistaken for an operator. A `jsonb` path filter will use the same `where`.
- `orderBy` takes a nested object per group and never a direction on the group. A member key is
  named by its field path (`netValue.amount`), which a keyset cursor's signature records.

### Writes

- `create` writes the members given, and the rest take their `$onCreate` or default. A group
  is required when it has a required member and no `.default(obj)`. `.default(obj)` sets member
  defaults.
- `update` writes only the members given. `null` sets every column `NULL`, and only a nullable
  group takes it.
- Hooks live on members only. A `FieldMutation` carries a field name or the column itself, so
  core writes a member without a name lookup.
- Primary keys, tenant claims, relation keys and discriminators stay plain columns.

### Prerequisites fixed on the way

- **`$onUpdate` ran only when its column was named** in `set`, and `getUpdateValue` returned the
  hook's value unencoded. It now runs on every update and is validated and encoded.
- **`DUPLICATE_SEQUENCE_NAME`**: an identity's explicit sequence name used twice in a namespace
  passed validation.

### Rejected alternatives

- **One builder for value objects and documents, with a storage flag** (from `0011`). The two
  storages differ in filters, nullability, indexing and migration.
- **Composite types.** DSQL has no `CREATE TYPE`.
- **Hand-prefixed columns.** The shape leaks into every resolver, and nothing is reusable.
- **`jsonb` as the value-object storage.** It cannot be indexed in DSQL, and needs a cast per
  comparison.
- **`Table.columns` keyed by dotted path** (the first draft). Every type derived from the column
  map needed a path mapper, and callers needed path strings.
- **Two-level nullability with a derived integrity CHECK.** It allowed an optional object with
  required fields, but needed a constraint the migration planner cannot re-plan (CHECK
  expressions are not normalized), and flat nullability lets the database enforce everything.
- **Direct member filters** (`netValue: { amount: … }`). They collide with operator names and
  with an operator-free object read as a value; the nested `where` is the one grammar.
- **A group-level `$onUpdate`.** Merging its object with the caller's members and the members'
  own hooks adds precedence rules that a member hook does not need.
- **`object()` as the builder name.** It reads like `record()`'s runtime type `object`, which has
  operators a group does not.

## Consequences

- Members are indexed, constrained, filtered and ordered as plain columns; a shape change is a
  column change for migrations.
- An optional object with required fields cannot be modelled: make the members nullable and
  validate in the application.
- `distinct` over a nullable group compares all of its columns.
- **Breaking, in `@dsqlbase/core`:** `TableConfig.columns` and the namespace and tenant column
  maps accept groups; `ColumnRefs` nests; constraint and index callbacks return `ColumnRefOf`;
  `IndexColumnDefinition`'s column parameter is any `DefinitionNode`; `Table.getColumn` returns
  `Column | ColumnGroup` and finds no member by database name; `getColumnEntries` lists plain
  columns only; `FieldSelection` gains a group entry; `FieldMutation` takes a column;
  `$onUpdate` runs on every update.
- **Breaking, in `dsqlbase`:** `FieldNamesOf` includes groups (`ColumnFieldNamesOf` is the
  column-only set).
- **Breaking, in `@dsqlbase/migration`:** `DUPLICATE_SEQUENCE_NAME`.
- Changeset level `minor` (`patch` for the migration rule).

### Deferred

- **Groups across a union.** The author is restructuring union members first. A union does not
  share a group field today.
- **A validator over the whole group**, for cross-member rules.
- **A generated member** whose expression names a sibling. No public builder sets one, and it
  would render the shape's unprefixed name.
- **Nested `where` into `jsonb` documents.**
- **Migration planner bugs found here**, left to the migrations work:
  - a column default re-plans as changed (`'-'` against `'-'::text`);
  - an explicit identity `sequenceName` is never emitted, and the `identity` diff never settles.

## Docs

- [Embedded objects (guide)](../guide/embeddable-objects.md) — reading, filtering, ordering,
  writing.
- [Schema (guide)](../guide/schema.md#embedded-objects) — declaring objects and groups.
- [Querying](../guide/querying.md), [Pagination](../guide/pagination.md),
  [Global ids](../guide/global-ids.md), [Migrations](../guide/migrations.md).
- [Runtime pipeline](../internals/runtime-pipeline.md#column-groups) — `ColumnGroup`, the
  nested `where`, insert fill.
- [Codec boundary](../internals/codec-boundary.md) — codecs and validators per member.
- [Migration pipeline](../internals/migration-pipeline.md) — `DUPLICATE_SEQUENCE_NAME`.
- [Architecture](../internals/architecture.md).
