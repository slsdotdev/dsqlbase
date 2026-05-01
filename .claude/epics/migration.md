---
epic: migration
status: in-progress
owner: silviu
created: 2026-05-01
---

# Migration module — consolidation epic

## Problem

The migration module under `packages/schema/src/migration/` is partially built and has drifted from the nine proposals in `.claude/proposals/`. We need to close the gaps, lock the design, and retire the old proposals. The current implementation is the source of truth where it conflicts with proposals; the proposals contribute durable rules (DSQL constraints, validation codes, refusal codes) which this epic captures inline.

## Scope

**In scope (v1):** schema, table (with columns, indexes, table constraints), domain, sequence. End-to-end pipeline: validate → introspect → normalize → reconcile (diff + plan) → execute.

**Out of scope (v1):** triggers, policies, grants, foreign keys (refused, not emitted), column rename detection (literal add+drop, drop is refused), type-tag conversions on existing data, unsupported-type pre-checks (the definition system already constrains types at compile time, so a runtime blocklist would be redundant), view & function migration (the AST kinds stay reserved for future use, but no diffs/operations are wired up).

## Architecture invariants

These are the rules the implementation must hold across stories — agreed in the epic kickoff conversation.

- **`SerializedSchema` is the contract** between introspection and reconciliation. Both local (via `toJSON()`) and remote (via introspection query) must produce the same shape. Adapter logic lives in the normalizer, not in reconciliation.
- **Diffs are dumb.** `diffs/*` has no knowledge of DSQL, refusals, or operation rules. It diffs every observable attribute and emits raw `Diff` records. Operations decide what to do with them.
- **Operations are the policy layer.** They translate diffs into DDL ops or refusals. All DSQL capability rules live here.
- **Per-subject batching.** All diffs for the same subject (a column, an index, a domain) collapse into one operation (or one refusal carrying all blocked diffs). A column with type + default + not-null changes produces one `ALTER_TABLE ALTER_COLUMN` with multiple sub-actions, or one refusal listing every blocked attribute.
- **Refusals are not errors.** A refusal is a structured record (`code`, `subject`, `diffs[]`, `message`). The runner can choose to fail on them or report them. Today they go in `errors[]`; the runner gates on that.
- **Renames are out of v1.** No detection. A renamed column appears as add+drop and the drop gets refused (`DSQL_NO_DROP_COLUMN`).
- **Ordering matters.** `ORDERED_SCHEMA_OBJECTS = ["SCHEMA", "DOMAIN", "TABLE", "SEQUENCE"]` — creates follow this order, drops reverse it. Operations within a table (column → index → constraint) get planned by the operation planner, not by emit order.

## DSQL capability reference (durable)

These rules drive both validation and refusals. They are PG-faithful where DSQL inherits, and DSQL-specific where it diverges.

### Supported

- `CREATE TABLE` (full column + table-constraint syntax)
- `ADD COLUMN` — **bare only**, no inline constraints
- `CREATE [UNIQUE] INDEX ASYNC` — every `CREATE INDEX` must emit `ASYNC`
- `ALTER TABLE ADD CONSTRAINT … UNIQUE USING INDEX` — promotion path for UNIQUE; the only way to land a UNIQUE constraint after CREATE TABLE
- `ALTER TABLE … RENAME` (table), `RENAME COLUMN`, `RENAME CONSTRAINT`, `SET SCHEMA`, `OWNER TO`
- Identity column ops: `ADD GENERATED [ALWAYS|BY DEFAULT] AS IDENTITY`, `DROP IDENTITY`, `SET GENERATED ALWAYS|BY DEFAULT`, `RESTART [WITH …]`
- `CREATE/DROP SCHEMA`, `CREATE/DROP DOMAIN`, `CREATE/DROP/ALTER SEQUENCE`
- `DROP` with `CASCADE` / `RESTRICT`

### Refused

| Code | What it blocks |
|---|---|
| `DSQL_NO_DROP_COLUMN` | Any column drop |
| `DSQL_NO_COLUMN_TYPE_CHANGE` | `ALTER COLUMN … SET DATA TYPE` on existing column |
| `DSQL_NO_ALTER_NOT_NULL` | `SET/DROP NOT NULL` on existing column |
| `DSQL_NO_ALTER_DEFAULT` | `SET/DROP DEFAULT` on existing column |
| `DSQL_NO_ALTER_CHECK` | Adding/dropping/modifying column-level CHECK on existing column |
| `DSQL_NO_GENERATED_EXPR_CHANGE` | Changing a generated-stored column's expression or stored mode (generated columns are immutable) |
| `DSQL_NO_DOMAIN_TYPE_CHANGE` | `ALTER DOMAIN … TYPE` |
| `DSQL_NO_FOREIGN_KEY` | Any foreign key declaration (also surfaced as a validation error) |

### Hard limits

- Identifier length: **63 bytes** (Postgres hard limit).
- Sequence `CACHE` must be `1` **or** `>= 65536` — DSQL constraint, validated and refused.
- Generated columns: `STORED` only (the type system already enforces this on `_generated.mode`).
- DSQL also forbids a list of PG types (`money`, `xml`, `tsvector`, ranges, inherited tables). The definition system pins `dataType` at compile time, so a runtime blocklist would be redundant — no validation rule is added for this.

---

## Stories

Order is fixed: each later story depends on earlier ones being solid.

### Story 1 — DDL: review nodes & close gaps

**Goal:** the AST + factory + printer cover every statement reconciliation will emit. No dead nodes.

`packages/schema/src/migration/ddl/`

- [ ] Reserved-but-unbuilt kinds stay in `ast.ts`:
  - `OWNER` action in `DDLAction` (line 25): keep. DSQL allows `ALTER … OWNER TO`. Define a concrete `OwnerAction` statement type, add it to `AnyAlterTableAction`, build it in `factory.ts`, print it in `printer.ts`, and cover it in `printer.test.ts`.
  - View / function commands (`CREATE_VIEW`, `ALTER_VIEW`, `DROP_VIEW`, `CREATE_FUNCTION`, `ALTER_FUNCTION`, `DROP_FUNCTION` in `DDLCommand`, lines 13–21): keep. They're reserved for future stories. No statement types, factories, or printer cases needed yet — add a one-line note near the union that they're intentionally unbuilt.
- [ ] Confirm `AlterIndexAction` is intentionally limited to `RenameTableAction | SetSchemaAction` (line 356). PG can't alter an index's column list — a column change must drop+recreate. Document this in a one-line comment near the type.
- [ ] Verify `printer.test.ts` covers every *built* statement kind in `AnyDDLStatement`. Add cases for any kind not exercised (including the new `OwnerAction`). The existing 36KB test file is the bar.
- [ ] `async` on `CreateIndexCommand` is a modifier, not a default. Callers (reconciliation operations) decide whether to pass it. Don't add a default in the factory or printer.

**Acceptance:** `npm test -w @dsqlbase/schema` passes; no AST kind is unprinted; no unused kinds remain.

---

### Story 2 — Introspection: query, normalizer, introspect

**Goal:** introspection produces a `SerializedSchema` byte-equivalent to what `toJSON()` produces locally, so reconciliation can compare without translation glue.

`packages/schema/src/migration/introspection/`

- [ ] **`query.ts` updates.** Currently selects schemas, tables, columns, indexes, domains, sequences, views, functions. Changes:
  - Remove `view_defs` and `function_defs` CTEs and their UNIONs — out of scope.
  - **Restructure table-constraint selection.** Today, primary key, unique, and check are scattered: PK is inferred per-column (`columns[].primaryKey`), single-column unique is per-column, multi-column unique is in `tables.unique`, check is in `tables.checks` for multi-column and per-column for single. Replace with a single `constraints` array per table that pulls every `pg_constraint` row for the table (`p`, `u`, `c`) with kind, name, columns, expression (for check). Tag column-level vs table-level in the normalizer, not in SQL.
  - **Add identity columns.** Select from `pg_attribute.attidentity` (`'a'` = ALWAYS, `'d'` = BY DEFAULT) plus the identity sequence options. Shape must match `ColumnIdentityConfig` (`{ type, options?, sequenceName? }`).
  - **Add generated columns.** Select from `pg_attribute.attgenerated` (`'s'` = stored). Pull the expression via `pg_get_expr(adbin, adrelid)` from `pg_attrdef`. Shape must match `ColumnGeneratedConfig` (`{ type: "ALWAYS", expression, mode: "STORED" }`).
- [ ] **`normalizer.ts`.** Currently a stub returning input unchanged. Implement:
  - Dispatches per `kind` into per-object normalizers.
  - For tables, splits the unified `constraints[]` into column-level (PK on a single column → `column.primaryKey = true`; UNIQUE on a single column → `column.unique = true`; CHECK whose `conkey = [single col]` → `column.check`) vs table-level (everything else).
  - Coerces null → undefined where the local `toJSON()` shape uses optional. The `ddl-serialized-adapter` proposal has a checklist — port the `nullsDistinct` / `distinctNulls` / `primaryKey` / `isPrimaryKey` rename rules here.
  - Returns a `SerializedSchema` that round-trips cleanly through `sortSchemaObjects`.
- [ ] **`introspect.ts`.** Currently empty. Implement `introspect(session: Session): Promise<SerializedSchema>`:
  - Execute `introspection` query (single round-trip).
  - Run normalizer on each row.
  - Sort via `sortSchemaObjects` and return.

**Acceptance:** unit tests round-trip a definition through `toJSON()` → mock introspection result → `normalizer` and assert deep-equal.

---

### Story 3 — Reconciliation: diffs, ops, refusals, planner

**Goal:** complete diff coverage; per-subject operations or refusals; ordered execution plan.

`packages/schema/src/migration/reconciliation/`

#### 3a. Diffs

`diffs/` — diff every observable attribute, no DSQL awareness.

- [ ] **`diffColumn`** (`diffs/table.ts:12`): add diffs for `generated` (whole `ColumnGeneratedConfig`) and `identity` (whole `ColumnIdentityConfig`, including nested options). Today's check-constraint handling at lines 104–124 stays.
- [ ] **`diffIndex`** (new function in `diffs/table.ts`): diff `unique`, `distinctNulls`, `columns[]` (column name, sort, nulls, position), `include[]`. Replaces the `// TBD` at line 178.
- [ ] **`diffConstraint`** (rename `diffCheckConstraint`, generalize): diff every constraint kind (`PRIMARY_KEY`, `UNIQUE`, `CHECK`) by name. For UNIQUE add `columns[]`, `include[]`, `nullsDistinct`. For PRIMARY_KEY add `columns[]`, `include[]`. For CHECK keep `expression`. Replaces the `// TBD` at line 208.
- [ ] **`diffSequence`** (`diffs/sequence.ts`) is complete — confirm coverage matches `SequenceDefinition.toJSON()` after any recent changes.
- [ ] **`diffDomain`** (`diffs/domain.ts`) is complete — confirm coverage.

#### 3b. Operations

`operations/` — per-subject batching; refusals as structured `DDLOperationError`.

- [ ] **`alterTableOperation`** (`operations/table.ts`): replace the empty branch at line 176. Group diffs by subject:
  - Per column → one `ALTER_COLUMN` action with all sub-actions, or one refusal listing every blocked attribute.
  - **Column `unique` flag transitions** (a special case of "column diff that produces a table-level operation, not a column-level one): `prev: false → current: true` emits `CREATE UNIQUE INDEX … ASYNC` + `ALTER TABLE … ADD CONSTRAINT … UNIQUE USING INDEX` against that column. `prev: true → current: false` emits `ALTER TABLE … DROP CONSTRAINT` for the auto-named unique constraint. These are emitted as table-level operations even though the diff originates from `diffColumn`, so the planner can order them after any preceding `ADD_COLUMN` for the same column.
  - Column adds → one `ADD_COLUMN` per added column. Refuse if the added column carries any inline constraint (DSQL bare-only) — except: the column-level NOT NULL/DEFAULT/CHECK on a *new* column at CREATE TABLE time is fine; on `ADD COLUMN` it isn't. Today `createTableOperation` (lines 30–48) emits all of these inline at create-time, which is correct; `ADD COLUMN` must strip them and emit a refusal. If the added column also has `unique: true`, the unique-flag promotion path above applies after the bare `ADD COLUMN`.
  - Column drops → always refuse (`DSQL_NO_DROP_COLUMN`).
  - Index adds → emit `CREATE_INDEX` with `async: true` (extract the helper from `createIndexOperation`, reuse).
  - Index drops → emit `DROP_INDEX`.
  - Index modifications → refuse-or-recreate-and-refuse (a column-list change on an existing index is a drop+recreate; we refuse the drop unless the operation is "drop only" or "create only", since DSQL allows both).
  - Constraint adds → for `UNIQUE`, emit `CREATE INDEX … ASYNC` followed by `ALTER TABLE … ADD CONSTRAINT … UNIQUE USING INDEX`. For `PRIMARY_KEY` on an existing table, refuse (DSQL can't add a PK after table creation without recreate). For `CHECK`, refuse (DSQL can't add CHECK after creation).
  - Constraint drops → emit `ALTER TABLE … DROP CONSTRAINT`. Allowed in DSQL.
- [ ] **Refusal records.** A refusal is `{ code, message, object, diffs?: Diff[] }` — extend `DDLOperationError` with optional `diffs` so per-subject refusals carry the full blocked list. One refusal per subject, never per diff.
- [ ] **Drop default = `RESTRICT`** to match Postgres. Today `dropTableOperation` (`operations/table.ts:144`) hard-codes `cascade: "CASCADE"` — switch to `"RESTRICT"`. Same default for `DROP_INDEX`, `DROP_DOMAIN`, `DROP_SEQUENCE`, `DROP_SCHEMA`. Callers (or the runner, via an explicit option) can override.
- [ ] **Domain ALTERs** (`operations/domain.ts`): refuse `dataType` changes (`DSQL_NO_DOMAIN_TYPE_CHANGE`); allow `notNull` (SET/DROP), `defaultValue` (SET/DROP — both add and remove transitions), and `check` (ADD/DROP/VALIDATE) via the existing `ALTER_DOMAIN` sub-actions.
- [ ] **Sequence ALTERs** (`operations/sequence.ts`): emit `ALTER_SEQUENCE` for option changes; validate `cache ∈ {1} ∪ [65536, ∞)` at the operation layer (mirrors validation rule).

#### 3c. Planner

- [ ] **Operation planner / sorter.** New file `operations/planner.ts`. Inputs the `IndexedDDLOperation[]` from `SchemaReconciler.run()`, outputs an ordered list. Rules:
  - Schemas before namespaced objects.
  - Domains before tables that use them (use `DDLOperation.references[]`).
  - Sequences before tables that own them (via `OWNED BY`).
  - For a table: CREATE TABLE → ADD COLUMN → CREATE INDEX → ADD CONSTRAINT USING INDEX (the UNIQUE promotion ordering is load-bearing).
  - Drops in reverse: DROP INDEX → DROP CONSTRAINT → DROP TABLE → DROP DOMAIN → DROP SCHEMA.
  - Within the same kind, preserve emission order (stable sort).
- [ ] **Reconcile entry point** (`reconcile.ts`): `reconcileSchemas` returns `{ operations, errors }` after planning, not before. Today it returns raw emission order.

**Acceptance:** new `reconcile.test.ts` cases for each refusal code, each batched ALTER scenario, each ordering invariant. Existing `reconcile.test.ts` still passes.

---

### Story 4 — Validation: rules + tests

`packages/schema/src/migration/validation/`

- [ ] Implement these error rules in `rules/`:
  - `TABLE_NO_PRIMARY_KEY` — every table must declare a PK (column-level or table-level).
  - `DUPLICATE_NAME` — exists as `noDuplicateObjectNames` in `rules/global.ts`. Keep.
  - `UNKNOWN_COLUMN_REFERENCE` — every column referenced in an index, constraint, or `ownedBy` exists on the parent table.
  - `EMPTY_CONSTRAINT_COLUMNS` — PK / UNIQUE constraints have non-empty `columns[]`.
  - `IDENTIFIER_TOO_LONG` — name byte-length ≤ 63 for every named object (table, column, index, constraint, domain, sequence, schema).
  - `FOREIGN_KEY_DECLARED` — surface FK declarations as a validation error (DSQL can't enforce them).
  - `RELATION_TARGET_MISSING` — relations point to tables in the schema.
  - `RESERVED_NAMESPACE` — namespace names don't collide with PG system schemas (`pg_catalog`, `pg_toast`, `information_schema`, `sys`).
  - `INVALID_SEQUENCE_CACHE` — `cache` is `1` or `>= 65536`.
- [ ] Implement these warnings:
  - `REDUNDANT_UNIQUE_ON_PK` — UNIQUE on the PK column set.
  - `DUPLICATE_INDEX_COVERAGE` — two indexes with identical column lists.
  - `VARCHAR_WITHOUT_LENGTH` — `varchar` with no length modifier (style nudge, not error).
  - `NO_INDEX_ON_RELATION_FK` — relation FK column without an index (write performance concern).
- [ ] Tests in `rules/<rule>.test.ts` per rule. One happy path, one violation per rule.

**Acceptance:** `npm test -w @dsqlbase/schema` covers each rule with a positive and negative case.

---

### Story 5 — Runner: wire everything together

`packages/schema/src/migration/runner.ts` and `executor.ts`.

- [ ] `runner.ts` already orchestrates validate → introspect → reconcile (line 25–107). Once Story 2 lands, the `throw "not implemented"` on introspection goes away.
- [ ] **`executor.ts` is empty.** Implement `MigrationExecutor` that:
  - Takes `IndexedDDLOperation[]` (planned).
  - Prints each statement via the DDL printer.
  - Executes via the supplied `Session` (one statement at a time, no implicit transaction — DSQL doesn't support DDL in transactions).
  - Returns `{ executed: number, statement: string }[]` for observability.
- [ ] Runner gates: any refusal in `errors[]` from reconciliation aborts the migration. Validation errors also abort. No bypass flag in v1.
- [ ] Dry-run mode (`runner.run({ dryRun: true })`) returns the plan + printed SQL without executing.

**Acceptance:** unit test: feed runner a `Session` mock + a small definition + a mock introspection result; assert the executed statement list matches expectation.

---

### Story 6 — E2E tests in `@dsqlbase/tests`

`packages/tests/src/specs/`

- [ ] New spec: `migration.spec.ts`. Uses PGlite. Scenarios:
  - **Bootstrap:** introspect empty DB → reconcile against `db/schema.ts` → execute. Re-introspect → reconcile → expect zero operations.
  - **Add column:** seed DB with v1 schema, mutate definition to add a (bare, non-FK) column → reconcile → execute → re-introspect → zero diff.
  - **Refusal: drop column.** Seed DB, mutate definition to remove a column → reconcile → expect `DSQL_NO_DROP_COLUMN` refusal, no execute.
  - **Refusal: alter type.** Seed DB, mutate definition to change a column type → expect `DSQL_NO_COLUMN_TYPE_CHANGE`.
  - **Index:** add a unique index → reconcile → execute → expect `CREATE INDEX ASYNC` + `ADD CONSTRAINT … UNIQUE USING INDEX`.
  - **Domain default change:** allowed.
  - **Sequence cache violation:** validation error before reconcile.

> Note: PGlite does not enforce DSQL's `ASYNC` requirement on indexes — assert on emitted SQL string, not just on round-trip success.

**Acceptance:** `npm run test:e2e -w @dsqlbase/tests` green.

---

## Decommissioning

After all six stories merge:

- [ ] Delete the nine proposals in `.claude/proposals/`. Every durable rule from them is captured in this epic; rationale lives in commits and PR descriptions from here on.
- [ ] Update `CLAUDE.md` if needed to point to `.claude/epics/` for future epic docs (today it only mentions proposals).

## Open questions deferred to post-v1

These came up during epic kickoff but aren't blocking:

- Column rename intent API (currently: not detected, drop is refused).
- Foreign key emission once DSQL ships them.
- Online column-type changes via shadow-column + backfill pattern.
- Triggers, policies, grants.
- View support (the AST has reservations; they're stripped from `DDLCommand` for v1).
