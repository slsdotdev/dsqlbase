# Definition Objects — Missing Features Audit

Catalog of missing features across all definition classes, organized by class. Each item notes what exists today, what's missing, and what the serialized output should include for the migrator.

Convention: `$`-prefixed methods are runtime-only (not serialized). Everything else should be serializable.

---

## SchemaDefinition

**Current state:** Name only. Has a `table()` factory method.

| Feature | Status | Notes |
|---|---|---|
| `name` | done | |
| `table()` factory | done | Creates table with schema association |
| `toJSON()` | incomplete | Only serializes `kind` + `name` |

**Missing:**
1. **`toJSON()` should include `authorization`** — DSQL supports `CREATE SCHEMA` with ownership. Not MVP-critical but worth noting.

No other gaps — schemas are thin wrappers.

---

## TableDefinition

**Current state:** Name, columns, indexes, optional schema reference. `toJSON()` serializes all of these.

| Feature | Status | Notes |
|---|---|---|
| `name` | done | |
| `columns` | done | |
| `_indexes` | done | |
| `_schema` | done | Optional schema reference |
| `index()` method | done | Creates and registers IndexDefinition |
| `toJSON()` | done | Serializes schema, columns, indexes |

**Missing:**
1. **CHECK constraints (table-level)** — `CHECK (col1 > 0)`, `CHECK (start_date < end_date)`. DSQL supports these on CREATE TABLE. Need `_checks: CheckConstraint[]` and a `.check(name, expression)` method.
2. **Composite unique constraints** — `UNIQUE (col1, col2)` as a table constraint (distinct from single-column `unique()`). Needed for compound uniqueness like `team_members(team_id, user_id)`. Currently this is done via unique indexes, which works, but a table-level constraint is semantically different.

---

## ColumnDefinition

**Current state:** Name, dataType, notNull, primaryKey, unique, defaultValue, codec, $onCreate, $onUpdate.

| Feature | Status | Notes |
|---|---|---|
| `name` | done | DB column name (snake_case) |
| `_dataType` | done | |
| `_notNull` | done | |
| `_primaryKey` | done | |
| `_unique` | done | |
| `_defaultValue` | done | But NOT serialized in `toJSON()` |
| `_codec` | done | Runtime-only, correct to not serialize |
| `_onCreate` | done | Runtime-only (`$onCreate`), correct to not serialize |
| `_onUpdate` | done | Runtime-only (`$onUpdate`), correct to not serialize |
| `.default()` | done | Sets `_defaultValue` |
| `.$type()` | done | Runtime type cast |
| `.notNull()` | done | |
| `.primaryKey()` | done | |
| `.unique()` | done | |
| `toJSON()` | incomplete | Missing `defaultValue` |

**Missing:**

1. **`defaultValue` not serialized in `toJSON()`** — The `.default(value)` method sets `_defaultValue` but `toJSON()` doesn't include it. The migrator needs this to generate `DEFAULT <value>` in CREATE TABLE DDL.

   Serialization needs care: the value can be a concrete JS value (`true`, `42`, `"active"`) or a SQL expression string (`"gen_random_uuid()"`, `"now()"`). We need a way to distinguish between literal values and SQL expressions.

   Suggestion: introduce a `_defaultExpression?: string` for SQL expressions (like `gen_random_uuid()`, `now()`, `nextval('seq')`), and keep `_defaultValue` for concrete values. `toJSON()` serializes as:
   ```json
   {
     "default": { "kind": "value", "value": true }
   }
   ```
   or:
   ```json
   {
     "default": { "kind": "expression", "value": "gen_random_uuid()" }
   }
   ```

   Currently `UUIDColumnDefinition.defaultRandom()` sets `_defaultValue = "gen_random_uuid()"` as a string — this conflates SQL expressions with literal string values.

2. **CHECK constraint (column-level)** — `CHECK (value > 0)`. DSQL supports this inline on CREATE TABLE. Need `.check(expression)` method and `_check?: string` property, serialized in `toJSON()`.

3. **GENERATED ALWAYS AS (expression) STORED** — Computed/generated columns. DSQL supports this. Need `.generatedAs(expression)` method. This is exclusive with `.default()`.

4. **Identity column support** — `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY (sequence_options)`. DSQL supports this. This is an alternative to sequences for auto-incrementing columns. Relevant for the OCC versioning use case. Need `.identity(mode, options?)` method where mode is `"always" | "byDefault"` and options can include `INCREMENT BY`, `START WITH`, `CACHE`, etc.

---

## IndexDefinition

**Current state:** Name, unique flag, table reference. Very minimal.

| Feature | Status | Notes |
|---|---|---|
| `name` | done | |
| `_unique` | done | |
| `_table` | done | Reference to parent table (not serialized) |
| `toJSON()` | incomplete | Missing columns, include, nulls |

**Missing:**

1. **`columns`** — Which columns the index covers. This is the most critical gap. Without this, the migrator cannot generate `CREATE INDEX ASYNC ... ON table (col1, col2)`. Need `_columns: string[]` (column names).

   The `table.index()` API should accept columns:
   ```typescript
   tasks.index("tasks_project_idx", { columns: ["project_id"] });
   tasks.index("tasks_team_key_idx", { columns: ["team_id", "key"], unique: true });
   ```

2. **`include`** — Non-key columns included in the index (`INCLUDE (col1, col2)`). DSQL supports this on CREATE INDEX ASYNC. Need `_include?: string[]`.

3. **Nulls sort order** — `NULLS FIRST | NULLS LAST` per column. DSQL supports this. This is per-column, so columns would need to be objects rather than plain strings:
   ```typescript
   { columns: [{ name: "due_date", nulls: "last" }] }
   ```
   Or simpler: just support it as a string format `"due_date NULLS LAST"` for now.

4. **`NULLS [NOT] DISTINCT`** — Index-level option for how nulls are treated in unique indexes. Need `_nullsDistinct?: boolean`.

5. **`toJSON()` needs all of the above** — Columns (required), include (optional), nullsDistinct (optional).

---

## DomainDefinition

**Current state:** Name, dataType, notNull, constraint. The `domain()` factory in schema package creates a dual function/object that acts as both a DomainDefinition and a column factory.

| Feature | Status | Notes |
|---|---|---|
| `name` | done | |
| `_dataType` | done | But NOT serialized in `toJSON()` |
| `_notNull` | done | |
| `_constraint` | done | CHECK constraint expression |
| `toJSON()` | incomplete | Missing `dataType`, `defaultValue` |

**Missing:**

1. **`dataType` not serialized in `toJSON()`** — Critical. Without this, we can't generate `CREATE DOMAIN name AS dataType`. The `_dataType` property exists but `toJSON()` omits it.

2. **`defaultValue`** — `CREATE DOMAIN` supports `DEFAULT value`. Need `_defaultValue` property, `.default(value)` method, and serialization in `toJSON()`.

3. **`DomainConfig.defaultValue` exists in the interface but is never used** — The config type declares `defaultValue: string` but the constructor ignores it and there's no method to set it.

4. **Column factory doesn't propagate domain constraints to columns** — When `domain("status")` is used as `status("col_name")`, the resulting ColumnDefinition gets `dataType: "status"` but doesn't carry the domain's notNull or constraint. The runtime should resolve the domain reference, but the serialized column needs to reference the domain by name so the migrator knows to create the domain first.

5. **Schema package doesn't export `domain`** — The `domain()` function exists in `packages/schema/src/definition/domain.ts` but is not re-exported from `packages/schema/src/index.ts`.

6. **Typed domain factory** — Currently `domain()` always creates columns typed as `string`. It should support generic value types so that `domain<"active" | "inactive">("status")` produces properly typed columns. The `$type()` method handles this at the column level but not at the domain level.

---

## SequenceDefinition

**Current state:** Just a name. Empty shell class — no properties, no methods, no configuration beyond what DefinitionNode provides.

| Feature | Status | Notes |
|---|---|---|
| `name` | done | |
| Everything else | missing | |

**Missing (everything):**

1. **`cache`** — Required by DSQL (`CACHE = 1` or `CACHE >= 65536`). This is mandatory, not optional. Need `_cache: number`.

2. **`dataType`** — DSQL only supports `BIGINT`. Need `_dataType: "bigint"` (can default to bigint).

3. **`increment`** — `INCREMENT BY n`. Default 1. Need `_increment?: number`.

4. **`minValue` / `maxValue`** — Sequence bounds. Need `_minValue?: number | null` and `_maxValue?: number | null` (null = no limit).

5. **`start`** — `START WITH n`. Need `_start?: number`.

6. **`cycle`** — `CYCLE | NO CYCLE`. Default no cycle. Need `_cycle?: boolean`.

7. **`ownedBy`** — `OWNED BY table.column`. Associates sequence with a column for auto-drop. Need `_ownedBy?: { table: string; column: string }`.

8. **Builder methods** — `.cache(n)`, `.increment(n)`, `.start(n)`, `.minValue(n)`, `.maxValue(n)`, `.cycle()`, `.ownedBy(table, column)`.

9. **`toJSON()`** — Needs to serialize all the above.

10. **Schema package factory** — Need a `sequence(name, options)` function in the schema package, exported from index.

---

## RelationsDefinition

**Current state:** Table reference, relations map with type/target/from/to. Feature-complete for current needs.

| Feature | Status | Notes |
|---|---|---|
| `table` | done | |
| `relations` | done | Map of relation configs |
| `toJSON()` | done | Full serialization |

**Missing:** Nothing for MVP. Relations are application-level and don't generate DDL. The current implementation covers `has_one`, `has_many`, `belongs_to` which is sufficient.

**Future consideration:** `many_to_many` through a junction table (sugar for two `has_many` + a junction table definition). Not needed now.

---

## ViewDefinition

**Current state:** Just a name. Empty shell.

**Missing:** Out of scope for this audit — deferring views entirely for now.

---

## Cross-cutting concerns

### 1. `toJSON()` consistency

Several classes have properties that aren't serialized:

| Class | Property | Serialized? |
|---|---|---|
| ColumnDefinition | `_defaultValue` | no |
| IndexDefinition | `_columns` | doesn't exist yet |
| IndexDefinition | `_table` | no (correct — circular ref) |
| DomainDefinition | `_dataType` | no |
| SequenceDefinition | everything | no (class is empty) |

### 2. SQL expression vs literal value

Multiple places need to distinguish between a SQL expression and a concrete value:
- Column defaults: `gen_random_uuid()` vs `true`
- Domain defaults: `now()` vs `"pending"`

Need a shared representation, e.g.:
```typescript
type SQLDefault =
  | { kind: "value"; value: unknown }
  | { kind: "expression"; sql: string };
```

`UUIDColumnDefinition.defaultRandom()` currently sets `_defaultValue = "gen_random_uuid()"` as a string — this should use the expression kind instead.

### 3. Schema package exports

Missing from `packages/schema/src/index.ts`:
- `domain` — exists but not exported
- `sequence` — factory doesn't exist yet
- `schema` — the `SchemaDefinition` constructor (for custom schemas)

---

## Summary: Priority order for implementation

**P0 — Blocks migration MVP:**
1. IndexDefinition: add `columns` property + serialization
2. ColumnDefinition: serialize `defaultValue` in `toJSON()` (with value vs expression distinction)
3. DomainDefinition: serialize `dataType` in `toJSON()`

**P1 — Needed for real-world schema definitions:**
4. SequenceDefinition: full implementation (cache, increment, start, etc.)
5. ColumnDefinition: identity column support (`.identity()`)
6. DomainDefinition: default value support
7. Domain factory: type propagation, export from schema package
8. Sequence factory: create and export from schema package

**P2 — Nice to have:**
9. ColumnDefinition: CHECK constraint (`.check()`)
10. ColumnDefinition: generated/computed columns (`.generatedAs()`)
11. TableDefinition: table-level CHECK constraints
12. IndexDefinition: INCLUDE columns, NULLS ordering, NULLS DISTINCT
13. SchemaDefinition: factory function + export from schema package
