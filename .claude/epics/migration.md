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

### Story 1 — DDL: review nodes & close gaps ✅

**Goal:** the AST + factory + printer cover every statement reconciliation will emit. No dead nodes.

`packages/schema/src/migration/ddl/`

- [x] Reserved-but-unbuilt kinds stay in `ast.ts`:
  - `OWNER` action: built — concrete `OwnerAction`, added to `AnyAlterTableAction`, factory + printer + tests.
  - View / function commands: kept reserved with a note at the union; intentionally unbuilt.
- [x] `AlterIndexAction` documented as intentionally limited to `RenameTableAction | SetSchemaAction`.
- [x] `printer.test.ts` covers every built kind. `AnyDDLStatement` printers exercised.
- [x] `async` on `CreateIndexCommand` stays a caller-supplied modifier (no factory default).

Story 3b also added two AST kinds the operations layer needs:
- `ADD_IDENTITY` sub-action (`ALTER COLUMN c ADD GENERATED [ALWAYS|BY DEFAULT] AS IDENTITY [options]`).
- `ADD_CONSTRAINT_USING_INDEX` table-level action (`ALTER TABLE T ADD CONSTRAINT n UNIQUE USING INDEX i`). Factory + printer + tests.

**Acceptance:** met. `npm test -w @dsqlbase/schema` green.

---

### Story 2 — Introspection: query, normalizer, introspect ✅

**Goal:** introspection produces a `SerializedSchema` byte-equivalent to what `toJSON()` produces locally.

`packages/schema/src/migration/introspection/`

- [x] **`query.ts`** — removed view/function CTEs; unified table constraints into a single `constraints[]` per table (PK/UNIQUE/CHECK with kind, name, columns, expression); identity and generated columns pulled via `pg_attribute.attidentity` / `attgenerated` and `pg_get_expr`.
- [x] **`normalizer.ts`** — per-kind dispatch; column-level vs table-level constraint split; null → undefined coercion; rename rules applied.
- [x] **`introspect.ts`** — single round-trip query, normalize, sort, return.

**Acceptance:** met. Round-trip tests in place.

---

### Story 3 — Reconciliation: diffs, ops, refusals, planner

**Goal:** complete diff coverage; per-subject operations or refusals; ordered execution plan.

`packages/schema/src/migration/reconciliation/`

#### 3a. Diffs ✅

`diffs/` — diff every observable attribute, no DSQL awareness.

- [x] Per-object split: `column.ts`, `indexes.ts`, `constraint.ts`, `domain.ts`, `sequence.ts`; `table.ts` orchestrates.
- [x] `hasDiff` is a recursive deep-equal over arrays / nested objects / primitives.
- [x] Column attrs diffed as whole-attribute keys: `generated`, `identity`, `check` are all whole-config diffs through the same loop (no name-only carve-out — see note below).
- [x] `diffIndex` covers `unique`, `distinctNulls`, `columns[]`, `include[]`.
- [x] `diffConstraint` dispatches PK / UNIQUE / CHECK; emits add when remote missing, modify per attr otherwise.
- [x] `diffDomain`, `diffSequence` confirmed complete.

**Note:** the simplified column/domain `check` diffing dropped the prior "name-only equality" carve-out. Equivalent expressions that PG normalizes (e.g. `qty > 0` vs `(qty > (0)::integer)`) now emit a `modify` diff, which the operations layer turns into an `IMMUTABLE_CONSTRAINT` refusal. Story 2 follow-up: normalize local expressions in the introspection adapter so re-introspection round-trips cleanly.

#### 3b. Operations ✅

`operations/` — per-subject batching; refusals as structured `DDLOperationError`.

Implemented behavior — note where it diverges from the original epic plan:

- [x] **`diffTableOperations`** existing-remote branch. Split into per-subject helpers (`processColumnDiffs` → `handleColumnAdd` / `handleColumnModify`, `processIndexDiffs`, `processConstraintDiffs`) under one orchestrator.
- [x] **Column adds**: bare `ADD COLUMN`. `unique: true` triggers the promotion path. `identity` on an added column emits bare `ADD COLUMN` + `ALTER COLUMN c ADD IDENTITY` in the same `ALTER TABLE` (identity is mutable, so no refusal). `notNull`, `defaultValue`, `check`, `primaryKey`, `generated` are non-promotable → `IMMUTABLE_COLUMN` refusal. Domain-typed columns push the domain into the `ALTER TABLE` op's `references[]` (planner uses it).
- [x] **Column modifies**: every attr is refused (`IMMUTABLE_COLUMN`) **except identity** (mutable: ADD/DROP/SET GENERATED/RESTART) and `unique: false → true` (promotion path).
- [x] **Column drops**: `NO_DROP_COLUMN`.
- [x] **Indexes**: adds emit `CREATE INDEX … ASYNC`; drops emit `DROP INDEX … RESTRICT`; modifies refuse `IMMUTABLE_INDEX`.
- [x] **Constraints (revised — diverges from original plan):** constraints are immutable in DSQL, so all constraint diffs refuse (`IMMUTABLE_CONSTRAINT`) **except** UNIQUE adds, which emit the promotion path. PK adds, CHECK adds, and any constraint drop or modify all refuse — the original plan's "constraint drops emit ALTER TABLE … DROP CONSTRAINT" is **not** what shipped.
- [x] **UNIQUE promotion is modeled as `type: CREATE, object: <UNIQUE_CONSTRAINT>`**, not as ALTER on the table. This breaks the self-loop (a table cannot reference itself via `references[]`) and lets the planner sequence `CREATE TABLE → ADD COLUMN → CREATE INDEX → CREATE constraint` cleanly.
- [x] **Refusal records** in `operations/base.ts`: `RefusalCode` union (`IMMUTABLE_COLUMN`, `NO_DROP_COLUMN`, `IMMUTABLE_CONSTRAINT`, `IMMUTABLE_DOMAIN`, `IMMUTABLE_INDEX`, `NO_FOREIGN_KEY`, `INVALID_SEQUENCE_CACHE`, `KIND_MISMATCH`); `DDLOperationError` extended with optional `subject` + `diffs`. **One refusal per subject** with all blocked attrs in the message + `diffs[]` payload (consolidation chosen over fine-grained codes).
- [x] **Drop defaults switched to `RESTRICT`** for `DROP_TABLE`, `DROP_DOMAIN`, `DROP_SEQUENCE`, `DROP_SCHEMA`, and the new `dropIndexOperation`. PG RESTRICT is also what guards "domain in use" — no separate logic needed.
- [x] **Domain ALTERs (revised — diverges from original plan):** only `defaultValue` SET/DROP/modify are allowed. `dataType`, `notNull`, and `check` all refuse `IMMUTABLE_DOMAIN`. The original plan allowed `notNull` SET/DROP and CHECK ADD/DROP — those have been removed because constraints are immutable and the user landed on a tighter "default-only" rule.
- [x] **Sequence ALTERs:** option changes emit `ALTER_SEQUENCE`. Cache validation **lives at the validation layer (story 4), not at the operation layer** — the original plan put it here as a mirror; that mirror was removed as redundant.

#### 3c. Planner

- [ ] **Operation planner / sorter.** New file `operations/planner.ts`. Inputs the `IndexedDDLOperation[]` from `SchemaReconciler.run()`, outputs an ordered list. Rules:
  - Schemas before namespaced objects.
  - Domains before tables that use them (use `DDLOperation.references[]`).
  - Sequences before tables that own them (via `OWNED BY`).
  - For a table: CREATE TABLE → ADD COLUMN → CREATE INDEX → CREATE constraint (UNIQUE-via-`USING INDEX`).
  - Drops in reverse: DROP INDEX → DROP TABLE → DROP DOMAIN → DROP SCHEMA. (No DROP CONSTRAINT — constraints are immutable; revisit if that ever changes.)
  - Within the same kind, preserve emission order (stable sort).
- [ ] **Reconcile entry point** (`reconcile.ts`): `reconcileSchemas` returns `{ operations, errors }` after planning, not before. Today it returns raw emission order.

**Notes for the implementer (carried over from 3b):**

- Story 3b emits `type: CREATE, object: <UNIQUE_CONSTRAINT>, references: [<table>, <index>]` for the promotion path. Constraint serializations have no `namespace` field, so `qualifiedName(object)` from `operations/base.ts` is **not** suitable as a registry key for these sub-objects.
- Constraint names are scoped to their parent table in PG (two tables can share `<x>_pkey`). The planner registry needs a composite key like `<tableQualifiedName>.<constraintName>` for these CREATE-on-constraint ops, separate from the table's own qualified name. Consider a `qualifiedConstraintName(parentTable, constraint)` helper alongside `qualifiedName`.
- `references[]` on the constraint op already lists `[tableName, indexName]` — the planner just needs to look those up correctly.
- ADD COLUMN ops with a domain-typed column carry the domain's name in `references[]` — the planner orders the domain ahead of the column add.
- Identity ops live inside `ALTER COLUMN` sub-actions of the table-level `ALTER_TABLE` op, so they ride along with the column work; no separate ordering needed.

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

Removed (stories 1, 2, 3a, 3b implemented; epic captures the durable rules):

- `ddl-ast-catalog.md`, `ddl-printer-phases.md` — Story 1.
- `ddl-serialized-adapter.md` — Story 2.
- `definition-objects-gaps.md` — definition layer audit, gaps closed across stories 1–3b.
- `migration-3b.md` — Story 3b proposal, just landed.
- `migrations-module-mvp.md`, `migration-strategy-research.md`, `semantic-constraints.md` — superseded by this epic.
- `reconciler.md` — original reconciler design; conflicts with the diff/operations split that shipped.

Still in `.claude/proposals/`:

- `validation-implementation-plan.md` — kept until Story 4 lands; the file layout / type sketch there is a useful jumping-off point.

Remaining cleanup once all six stories merge:

- [ ] Delete `validation-implementation-plan.md`.
- [ ] Update `CLAUDE.md` if needed to point to `.claude/epics/` for future epic docs (today it only mentions proposals).

## Open questions deferred to post-v1

These came up during epic kickoff but aren't blocking:

- Column rename intent API (currently: not detected, drop is refused).
- Foreign key emission once DSQL ships them.
- Online column-type changes via shadow-column + backfill pattern.
- Triggers, policies, grants.
- View support (the AST has reservations; they're stripped from `DDLCommand` for v1).
