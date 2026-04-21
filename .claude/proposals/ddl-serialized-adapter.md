# DDL Serialized → AST Adapter — Design Proposal

## Overview

`packages/schema/src/migration/ddl/schema.ts` is the utility that emits full "create schema" DDL from a serialized schema. It currently inlines the mapping from each serialized entry to its DDL AST subtree:

```ts
const columns = obj.columns.map((col) =>
  ddl.column({
    name: col.name,
    dataType: col.dataType,
    isPrimaryKey: col.primaryKey,
    notNull: col.notNull,
    defaultValue: col.defaultValue,
    unique: col.unique,
    check: col.check
      ? ddl.check({ name: col.check.name, expression: col.check.expression })
      : undefined,
  })
);
```

Every serialized kind gets the same treatment. The result is verbose, repetitive, and mixes orchestration (walk schema → emit statements) with translation (serialized shape → AST shape).

The differ will face the same mapping problem — it walks pairs of serialized schemas and produces AST statements for the diff. If we inline the mapping again there, we'll have two copies of the same translation logic drifting out of sync.

This proposal extracts the serialized → AST translation into a dedicated adapter layer.

---

## Why not extend the factories?

The tempting shortcut is to give `ddl.column`, `ddl.createTable`, etc. a second input shape — the serialized form — so callers can write `ddl.column(serializedCol)` directly. Rejecting this:

1. **Factories are primitive AST constructors.** They'll be called by the adapter, by tests, and by the differ when building synthesized nodes (e.g. diff-only `AddColumnAction` that has no counterpart in any serialized input). Coupling them to the "wire" shape breaks that neutrality.
2. **Overloads get ugly fast.** Serialized column, DDL column param, and raw `ColumnDefinitionExpression` would all need to resolve cleanly. Serialized constraints nest `IndexColumn` records (with full column refs), while AST constraints take plain `string[]` — not a field rename, a flattening. That's adapter work, not construction.
3. **Two input shapes, not one.** The adapter needs to accept both local (`toJSON()`) and remote (introspection) serialized shapes, per [ddl-ast-catalog.md](./ddl-ast-catalog.md#input-source). Factories would either have to handle both or we'd end up with the adapter anyway — so keep factories dumb and put the shape-normalization in one place.

---

## Proposed structure

A new module: `packages/schema/src/migration/ddl/adapter.ts`.

It exposes one function per serialized kind, returning the corresponding AST subtree. Functions are keyed by the serialized `kind` field so they can be dispatched by a central `fromSerialized` entry point.

```ts
// adapter.ts
import type {
  SerializedColumn,
  SerializedTable,
  SerializedIndex,
  SerializedIndexColumn,
  SerializedConstraint,
  SerializedDomain,
  SerializedSequence,
  SerializedView,
} from "...";
import type { DDLStatement, ColumnDefinitionExpression, ... } from "./ast.js";
import { ddl } from "./factory.js";

export function columnFromSerialized(col: SerializedColumn): ColumnDefinitionExpression {
  return ddl.column({
    name: col.name,
    dataType: col.dataType,
    isPrimaryKey: col.primaryKey,
    notNull: col.notNull,
    unique: col.unique,
    defaultValue: col.defaultValue,
    check: col.check
      ? ddl.check({ name: col.check.name, expression: col.check.expression })
      : undefined,
  });
}

export function indexColumnFromSerialized(
  col: SerializedIndexColumn
): IndexColumnExpression {
  return ddl.indexColumn({
    columnName: col.column.name,
    sortDirection: col.sortDirection,
    nulls: col.nulls,
  });
}

export function constraintFromSerialized(
  c: SerializedConstraint
): TableConstraintExpression {
  switch (c.kind) {
    case "CHECK_CONSTRAINT":
      return ddl.check({ name: c.name, expression: c.expression });
    case "PRIMARY_KEY_CONSTRAINT":
      return ddl.primaryKey({
        name: c.name,
        columns: c.columns.map((ic) => ic.column.name),
        include: c.include?.map((ic) => ic.column.name),
      });
    case "UNIQUE_CONSTRAINT":
      return ddl.unique({
        name: c.name,
        columns: c.columns.map((ic) => ic.column.name),
        include: c.include?.map((ic) => ic.column.name) ?? undefined,
        nullsDistinct: c.distinctNulls ?? undefined,
      });
  }
}

export function indexFromSerialized(
  idx: SerializedIndex,
  tableName: string
): CreateIndexCommand {
  return ddl.createIndex({
    name: idx.name,
    tableName,
    unique: idx.unique,
    columns: idx.columns.map(indexColumnFromSerialized),
    include: idx.include?.map((ic) => ic.column.name) ?? undefined,
    nullsDistinct: idx.distinctNulls ?? undefined,
    ifNotExists: true,
  });
}

export function tableFromSerialized(
  table: SerializedTable,
  opts: { ifNotExists?: boolean } = {}
): { create: CreateTableCommand; indexes: CreateIndexCommand[] } {
  return {
    create: ddl.createTable({
      name: table.name,
      ifNotExists: opts.ifNotExists,
      columns: table.columns.map(columnFromSerialized),
      constraints: table.constraints?.map(constraintFromSerialized),
    }),
    indexes: table.indexes?.map((idx) => indexFromSerialized(idx, table.name)) ?? [],
  };
}
```

(Domain, sequence, view, namespace adapters follow the same pattern — they're left out here for brevity but covered in the phased plan below.)

### `schema.ts` after the extraction

```ts
import { tableFromSerialized, domainFromSerialized, /* ... */ } from "./adapter.js";

export function printSchemaForCreate(
  schema: SerializedSchema,
  options?: PrintSchemaOptions
): SQLQuery {
  const ifNotExists = options?.ifNotExists ?? true;
  const statements: DDLStatement[] = [];

  for (const obj of sortSchemaObjects(schema)) {
    switch (obj.kind) {
      case "SCHEMA":
        statements.push(namespaceFromSerialized(obj, { ifNotExists }));
        break;
      case "DOMAIN":
        statements.push(domainFromSerialized(obj));
        break;
      case "TABLE": {
        const { create, indexes } = tableFromSerialized(obj, { ifNotExists });
        statements.push(create, ...indexes);
        break;
      }
      case "SEQUENCE":
        statements.push(sequenceFromSerialized(obj));
        break;
      case "VIEW":
        statements.push(viewFromSerialized(obj));
        break;
    }
  }

  return joinStatements(statements.map((s) => printDDL(s)), options?.sqlContext);
}
```

`schema.ts` becomes a pure orchestrator: sort → dispatch → join. No field-level translation remains.

---

## Divergences the adapter absorbs

These are the non-trivial bits the current inline mapping gets wrong or handles fragilely. Centralizing them in the adapter kills the latent bugs and gives a single place to fix regressions.

### Constraint `columns` is a list of index-column records, not strings

Serialized `UniqueConstraint.columns` and `PrimaryKeyConstraint.columns` are `IndexColumnDefinition[]` (each with a `column: {kind, name}` NodeRef), not `string[]`. The current `schema.ts` passes them straight through to `ddl.unique({ columns: constraint.columns })`, which is a type error waiting to fail — the adapter flattens `col.column.name`.

### Field name renames

| Serialized | AST |
|---|---|
| `primaryKey` | `isPrimaryKey` |
| `distinctNulls` | `nullsDistinct` |

### `null` vs `undefined` for optional fields

Serialized forms use `null` for absent optional values (`check: null`, `include: null`, `defaultValue: null` on columns). AST interfaces use `undefined`. The adapter normalizes with `?? undefined` where the distinction matters (most AST fields are `?: T` with no meaningful `null` state).

`defaultValue` on columns is the exception — the AST requires `string | null` explicitly (see `ColumnDefinitionExpression.defaultValue`), so no coercion needed there.

### Remote vs local schema shape

The introspection result diverges from `toJSON()` in a few places (per [ddl-ast-catalog.md](./ddl-ast-catalog.md#input-source)): indexes carry a raw `statement` field, unique constraints have a different nested shape, etc. The adapter is the natural place to branch on shape, so the rest of the codebase sees one AST regardless of source.

*Scope note:* this proposal implements the **local** (`toJSON()`) adapter first. The remote adapter is a follow-up that reuses the same output type but reads from the introspection result shape.

---

## File layout

```
packages/schema/src/migration/ddl/
├── ast.ts          (unchanged)
├── factory.ts      (unchanged — stays as primitive AST constructors)
├── printer.ts      (unchanged)
├── printer.test.ts (unchanged)
├── adapter.ts      (NEW — serialized → AST)
├── adapter.test.ts (NEW)
└── schema.ts       (rewritten — thin orchestrator using adapter)
```

---

## Phased plan

1. **Add adapter skeleton.** Create `adapter.ts` with the `columnFromSerialized`, `checkFromSerialized`, `indexColumnFromSerialized`, `constraintFromSerialized` (dispatching on `kind`), `indexFromSerialized`, and `tableFromSerialized` functions. Typecheck against the existing `SerializedObject<T>` types from `base.ts`.
2. **Rewrite `schema.ts`.** Replace the inline mapping with adapter calls. Add the missing `namespace` / `domain` / `sequence` / `view` branches so `printSchemaForCreate` actually returns something (today it builds `statements` and drops them on the floor). Wire up `printDDL` + statement joining.
3. **Port tests.** Unit tests per adapter function, using `packages/tests/src/schema/data/schema.json` as the end-to-end fixture. Assert the final SQL matches `packages/tests/src/schema/migrations/schema_create.sql`.
4. **Follow-up (separate PR):** remote adapter for the introspection result shape, reusing the same output types.

---

## Open questions

1. **Adapter return type for tables.** The current sketch returns `{ create, indexes }` because indexes are sibling statements, not children of `CREATE TABLE`. Alternative: return `DDLStatement[]` so the orchestrator just spreads. Slight preference for the structured return — it makes the "table has indexes" relationship explicit and the differ can ignore indexes if it only cares about columns. Open to the flat-array version if it simplifies the call site.
2. **Where does dispatch-by-kind live?** Options: (a) one big `fromSerialized(obj)` switch in `adapter.ts`, (b) keep dispatch in `schema.ts` (as drafted above), (c) reducer-style keyed object mirroring the printer. `schema.ts` is the only consumer for now, so inline switch is fine — but a reducer pattern would let the differ reuse the dispatch. Lean toward **(b) for now, refactor to (c) when the differ arrives**.
3. **Should `ifNotExists` be a per-call option or a top-level toggle?** Currently `printSchemaForCreate` takes a schema-wide `ifNotExists` flag. The adapter threads it through as `opts.ifNotExists`. Fine as-is, but worth flagging if we want per-kind control later (e.g. skip `IF NOT EXISTS` on domains but keep it on tables).
