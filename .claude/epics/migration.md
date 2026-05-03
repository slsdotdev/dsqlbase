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

#### 3c. Planner ✅

Implemented as a **type-agnostic** stable topological sort over `IndexedDDLOperation[]`. The planner inspects only `id`, `type`, and `references[]` — no per-kind rules. Every ordering invariant in the original bullet list is realized by the relevant operation declaring its dependencies in `references[]`; the planner just resolves them.

- [x] **Planner.** New file `reconciliation/planner.ts` (sibling to `reconcile.ts`, not under `operations/` — it's a reconciliation-level concern, not an operation factory).
  - `planOperations(ops)` builds a subject registry, a dependency graph, and runs Kahn's with a min-id tiebreaker for stability.
  - For `CREATE`/`ALTER` X: edges `dep → X` for each `dep` touching a subject in `X.references`.
  - For `DROP` X: edges `X → dep` (drops run before the things that point at the subject they remove).
  - Subjects key on `qualifiedName(object)` for namespaced objects, and on `qualifiedConstraintName(parentTable, constraint)` for standalone constraint ops (parent pulled from `references[0]`). New helper added to `operations/base.ts`.
  - Cycles throw with a list of the offending op ids — they signal a bug in operation emission, not user input.
- [x] **Reconcile entry point** (`reconcile.ts`): `reconcileSchemas` returns `planOperations(this._operations)`. The old `_operationRegistry` / `_registerOperation` were removed (planner reconstructs the registry).

**How the original bullet list collapsed into `references[]`:**

- _Schemas before namespaced objects_ — namespaced-object ops already push the namespace via `maybeNamespaceReference`.
- _Domains before tables that use them_ — `createTableOperation` and ADD COLUMN ops push column domain names.
- _For a table: CREATE TABLE → ADD COLUMN → CREATE INDEX → CREATE constraint_ — index ops reference the table; the promotion-path constraint op references `[table, index]`.
- _Drops in reverse_ — same edges, opposite direction (DROP-handling rule above).
- _Stable within same kind_ — emission `id` is the tiebreaker.

**Deferred:** _Sequences before tables that own them (via `OWNED BY`)_. The public `SequenceDefinition.ownedBy()` setter is commented out and the local/introspection serializations of `ownedBy` don't agree (single quoted ident vs dot-separated). Wiring `references[]` for `OWNED BY` is gated on fixing that plumbing first; covered by a single one-line change to `createSequenceOperation` once the serialization is structured. No planner change needed when it lands.

**Acceptance:** met. New `planner.test.ts` covers ref direction (CREATE/DROP), transitive deps, schema-before-namespaced, domain-before-ALTER, the UNIQUE promotion chain, stability within a subject, independent-op interleaving, constraint-name collision isolation across tables, and cycle detection. `reconcile.test.ts` unchanged and green. `npm test -w @dsqlbase/schema` → 272/272.

---

### Story 4 — Validation: rules + tests ✅

`packages/schema/src/migration/validation/`

Implemented behavior — note where it diverges from the original epic plan:

- [x] **Type relaxation.** `Rule<T>` was widened from `Rule<T extends SchemaObjectType["name"]>` to `Rule<T extends DefinitionNode>`, so a single rule (`identifierTooLong`) can target any named node — top-level objects via the registry and nested children (columns, indexes, constraints) via reuse from the table rules. The registry-key bug was fixed at the same time: `ValidationRules` now keys on `SchemaObjectType["kind"]` instead of `["name"]` (runtime dispatch already used `node.kind`).
- [x] **`ValidationIssue.level`** dropped `"notice"` (warnings cover the same use case; notices were silently discarded by `getResults()` anyway).
- [x] **Error rules:**
  - `TABLE_NO_PRIMARY_KEY` — column-level OR table-level PK constraint.
  - `DUPLICATE_OBJECT_NAME` — kept the existing `noDuplicateObjectNames` global rule and its existing code (epic name `DUPLICATE_NAME` was an alias attempt; we kept the original to avoid a churn rename).
  - `UNKNOWN_COLUMN_REFERENCE` — walks `constraints[*].columns` (PK/UNIQUE) and `indexes[*].columns[*].column` against the table's column set. **`ownedBy` is not checked** — deferred until the sequence-`ownedBy` plumbing lands (see Story 3c deferred note).
  - `EMPTY_CONSTRAINT_COLUMNS` — PK / UNIQUE only (CHECK has no `columns[]`).
  - `IDENTIFIER_TOO_LONG` — single generic rule in `rules/global.ts`. Registered against SCHEMA / DOMAIN / TABLE / SEQUENCE for top-level names; reused from `tableIdentifiersTooLong` for columns/indexes/constraints. UTF-8 byte length via `Buffer.byteLength(name, "utf8")`.
  - `RESERVED_NAMESPACE` — blocks `pg_catalog`, `pg_toast`, `information_schema`, `sys`, and any `pg_*`.
  - `INVALID_SEQUENCE_CACHE` — `cache === 1 || cache >= 65536`. Lives in `rules/sequence.ts` only; the matching `RefusalCode` was removed from `operations/base.ts` since validation gates first.
- [x] **Warning rules:**
  - `REDUNDANT_UNIQUE_ON_PK` — UNIQUE constraint or unique index whose ordered column set equals the PK set.
  - `DUPLICATE_INDEX_COVERAGE` — two indexes with identical ordered column lists.
  - `VARCHAR_WITHOUT_LENGTH` — column `dataType === "varchar"`.
- [x] **Default registry** lives inline next to the global rules in `validate.ts` (`defaultRules`, frozen). `validateDefinition(definition, rules = defaultRules)` runs globals first, then dispatches by `node.kind`. Caller can pass a custom registry to override.
- [x] **Tests** — one test file per rule file (not per rule): `rules/global.test.ts`, `rules/table.test.ts`, `rules/schema.test.ts`, `rules/sequence.test.ts`. One `describe` per rule, happy + violating cases per failure mode. Fixtures use raw `SerializedObject<…>` JSON to match the existing reconciliation-test convention rather than running through the high-level builders.

**Dropped from the epic plan (out of scope, recorded for future):**

- `FOREIGN_KEY_DECLARED` — no rule shipped because the serialized table shape doesn't carry FK declarations yet. The rule lands together with the FK serialization.
- `RELATION_TARGET_MISSING`, `NO_INDEX_ON_RELATION_FK` — relations are a runtime-only construct; they're not part of `SerializedSchema`. Validating them at the migration layer would be redundant.
- `UNSUPPORTED_TYPE` — the proposal had it; the epic dropped it as redundant with the compile-time `dataType` constraint. Stayed dropped.

**Acceptance:** met. `npm test -w @dsqlbase/schema` → 306/306 (was 272 after Story 3c).

---

### Story 5 — Runner: wire everything together ✅

`packages/schema/src/migration/runner.ts`, `executor.ts`.

Implemented as a CLI-shaped runner backed by a small `OperationExecutor`. The earlier proposal (`.claude/proposals/migration-runner.md`, since deleted) explored a per-step API for durable hosts and runner-driven async batching; that design was rejected as over-engineered for v1. Durable orchestration stays the consumer's problem — the runner exposes the primitives a durable wrapper can drive (`validate`, `introspect`, `reconcile`, `plan`), but does not bake any workflow assumptions in.

- [x] **Runner surface** (`runner.ts`):
  - `validate(definition)` — sync, no IO.
  - `introspect()` — 1 IO call, returns `SerializedSchema`.
  - `reconcile(local, remote, options)` — sync; planner runs inside.
  - `plan(definition, options)` — `validate` + `introspect` + `reconcile`; returns `{ operations, errors, destructive }`.
  - `dryRun(definition, options)` — returns the printed `SQLStatement[]` for the plan; no DDL executed.
  - `run(definition, options)` — sequential CLI orchestrator. Loops over the plan and awaits each op (including async jobs) before moving on.
- [x] **Async detection via response shape, not statement kind.** The DDL executor (`executor.ts`) inspects the returned row: any `{ job_id }` payload is treated as async, regardless of statement (`CREATE INDEX ASYNC`, `DROP INDEX`, future async ops). The fragile "look for `CREATE INDEX ASYNC` in the SQL" heuristic from the proposal was discarded.
- [x] **`OperationExecutor`** (`executor.ts`): kept as a thin abstraction that owns per-op SQL printing, sync/async dispatch, and DSQL job polling (`sys.jobs`, `call sys.wait_for_job`). Returns an `OperationExecutionResult` carrying `opId`, `sql`, `status` (`processing` | `completed` | `failed`), and an `asyncJob` payload when applicable. The runner is just a sequencer over this.
- [x] **Sequential execution.** `run()` waits for every async job (`waitAsyncJob`) before kicking off the next op. Parallel batching is an optimization for a future durable consumer, not the runner.
- [x] **`MigrationRunnerOptions` extends `Partial<DDLOperationOptions>`** so dialect-shaping flags (`asyncIndexes`, `safeOperations`) flow through `plan` / `dryRun` / `run` into the operation factories. This is the seam that lets PGlite (no `ASYNC`) and DSQL share the same runner.
- [x] **Gates.** Invalid definitions throw `MigrationError` from `plan`/`dryRun`/`run`. Reconciliation refusals throw `MigrationError` from `dryRun`/`run` (they remain in `plan().errors[]`). Destructive operations require explicit `destructive: true` opt-in. No bypass flags beyond that.
- [x] **Dialect-aware reconciliation.** `runner.reconcile(local, remote, options)` accepts `Partial<DDLOperationOptions>` and forwards them to operation factories.

**Diverges from the proposal (`migration-runner.md`):**

- Proposal: delete `executor.ts`, fold per-op execution into the runner. Shipped: `executor.ts` retained — keeps the SQL print + async-poll machinery in one place and lets the runner stay focused on sequencing.
- Proposal: runner-level async batching with a `awaitBatch` primitive. Shipped: sequential `run()`. Batching can be reintroduced in a durable consumer when the workload demands it.
- Proposal: classify async via `op.statement.__kind === "CREATE_INDEX" && async`. Shipped: detect via response payload (`job_id`) — covers `DROP INDEX` and any future async DDL without a planner-level switch.
- Proposal: pluggable `AsyncJobTracker` + `NoopAsyncJobTracker` default. Shipped: executor talks to `sys.jobs` directly. PGlite is exercised with `asyncIndexes: false`, which keeps every op synchronous and avoids the need for a noop tracker.
- Proposal: durable-host primitives (`executeOperation`, `awaitBatch`) on the runner surface. Shipped: not exposed. The runner's published primitives stop at `plan` / `reconcile` / `dryRun`; durable wrappers compose those plus their own execution loop.

**Acceptance:** met. `runner.test.ts` covers the validate/introspect/plan/dryRun/run surface (including async-job polling, refusal gates, destructive gate, dialect-option propagation). E2E coverage lives in `@dsqlbase/tests` (Story 6).

---

### Story 6 — E2E tests in `@dsqlbase/tests` 🟡

`packages/tests/src/specs/migration.spec.ts`

PGlite-backed scenarios driving the runner end-to-end. Run with `asyncIndexes: false, safeOperations: true, destructive: true` so PG can execute the DDL DSQL would normally route through `ASYNC`. Scenarios shipped:

- [x] **Bootstrap:** empty DB → `runner.run([table])` → re-introspect, assert the table is present.
- [x] **Idempotent re-run:** apply once, then `runner.plan()` again → expect zero operations and zero errors.
- [x] **Refusal: drop column** → `NO_DROP_COLUMN` in `plan().errors`, `run()` rejects.
- [x] **Refusal: alter column type** → `IMMUTABLE_COLUMN`.
- [x] **Domain + sequence + table:** assert dependency order (`CREATE DOMAIN` before `CREATE TABLE`).
- [x] **Sequence cache validation** → `INVALID_SEQUENCE_CACHE`, `run()` rejects.
- [⚠️] **CREATE INDEX (unique):** test exists but currently fails — DDL printer emits an index column reference of the form `<index>_column_<col>` instead of `<col>`, so PGlite rejects the statement (`column "..._column_slug" does not exist`). Test asserts the intended behavior; tracking the printer fix as a follow-up.

**Acceptance:** `npm run test:e2e -w @dsqlbase/tests` runs the suite; one test fails by design pending the printer fix above.

**Follow-ups outside the e2e scope but surfaced by the runner integration tests:**

- Diff layer flags `IMMUTABLE_COLUMN` on a column whose serialized JSON is identical between local and remote. Reproduced in `runner.test.ts`'s destructive-flow tests (kept failing, documented inline). Likely cause: a non-symmetric attribute being read on one side only.

---

## Decommissioning

Removed (stories 1, 2, 3a, 3b, 3c, 4, 5 implemented; epic captures the durable rules):

- `ddl-ast-catalog.md`, `ddl-printer-phases.md` — Story 1.
- `ddl-serialized-adapter.md` — Story 2.
- `definition-objects-gaps.md` — definition layer audit, gaps closed across stories 1–3b.
- `migration-3b.md` — Story 3b proposal, just landed.
- `migration-3c-planner.md` — Story 3c shipped; planner design lives in this epic.
- `migration-runner.md` — Story 5 shipped a smaller, sequential runner; proposal's durable-host primitives + runner-level batching were rejected.
- `migrations-module-mvp.md`, `migration-strategy-research.md`, `semantic-constraints.md` — superseded by this epic.
- `reconciler.md` — original reconciler design; conflicts with the diff/operations split that shipped.
- `validation-implementation-plan.md` — Story 4 landed; current implementation diverges from the proposal (imperative `(node, ctx) => void` rules, bare string codes, no `CODES` const map, default registry inline in `validate.ts`).

Remaining cleanup:

- [ ] Update `CLAUDE.md` if needed to point to `.claude/epics/` for future epic docs (today it only mentions proposals).

## Open questions deferred to post-v1

These came up during epic kickoff but aren't blocking:

- Column rename intent API (currently: not detected, drop is refused).
- Foreign key emission once DSQL ships them.
- Online column-type changes via shadow-column + backfill pattern.
- Triggers, policies, grants.
- View support (the AST has reservations; they're stripped from `DDLCommand` for v1).
