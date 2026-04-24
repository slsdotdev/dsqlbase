# Migrations Module — MVP Design Proposal

## Overview

A declarative, introspection-based schema reconciler for Aurora DSQL. Given a
serialized schema definition and a live DB, the migrator emits the DDL needed to
make the DB capable of serving the schema.

**Scope.** Reconciles *shape* — tables, columns, indexes, primary keys,
uniqueness, namespaces. Does **not** reconcile *semantics* — nullability,
defaults, check constraints, relation cardinality. Those live at the ORM layer;
see [`semantic-constraints.md`](./semantic-constraints.md) and
[`migration-strategy-research.md`](./migration-strategy-research.md) for why.

This split keeps reconciliation nearly-always-successful: the migrator only
emits forward-compatible ops DSQL allows, so DDL refusal is not a design case.

### DSQL DDL constraints (probed 2026-04-22)

| Action                                                               | Allowed? | Used by migrator?                                                                     |
| -------------------------------------------------------------------- | :------: | :------------------------------------------------------------------------------------ |
| `CREATE TABLE` with inline constraints                               |    ✅    | Only PK + column types are inlined. `NOT NULL` / `DEFAULT` / `CHECK` are ORM-side.    |
| `ADD COLUMN` bare (`name type`)                                      |    ✅    | ✅                                                                                    |
| `ADD COLUMN` with any constraint                                     |    ❌    | Never attempted                                                                       |
| `DROP COLUMN`                                                        |    ❌    | Never attempted                                                                       |
| `ALTER COLUMN` constraint/type changes                               |    ❌    | Never attempted                                                                       |
| `ALTER COLUMN` identity ops                                          |    ✅    | Deferred                                                                              |
| `RENAME` / `RENAME COLUMN` / `RENAME CONSTRAINT`                     |    ✅    | Deferred (needs intent signal)                                                        |
| `SET SCHEMA`                                                         |    ✅    | Deferred                                                                              |
| `CREATE INDEX ASYNC` (with optional `UNIQUE`)                        |    ✅    | ✅                                                                                    |
| `ALTER TABLE ADD CONSTRAINT … UNIQUE USING INDEX`                    |    ✅    | ✅ for new uniqueness on existing columns                                             |
| `DROP INDEX`                                                         |    ✅    | Deferred (opt-in)                                                                     |
| `CREATE / DROP SCHEMA`                                               |    ✅    | ✅ (create only)                                                                      |

Runtime rules:

- **One DDL per transaction.** No multi-statement DDL, no DDL+DML mixing.
- **Async index creation.** `CREATE INDEX ASYNC` returns a `job_id`; completion
  is tracked via `sys.jobs`. The executor submits and returns; the orchestrator
  polls.
- **OCC retries.** DDL bumps the catalog version; concurrent sessions see
  `SQLSTATE 40001` / `OC001`. The session client handles backoff.

### MVP operations

1. `CREATE SCHEMA IF NOT EXISTS` — declared namespace missing.
2. `CREATE TABLE` — declared table missing. Inlines PK + column types only.
3. `ADD COLUMN` — declared column missing on an existing table. Always bare.
4. `CREATE [UNIQUE] INDEX ASYNC` — declared index missing, or unique-constraint
   promotion needs a backing index first.
5. `ALTER TABLE ADD CONSTRAINT … UNIQUE USING INDEX` — promote a VALID unique
   index into a true constraint.

**Not in MVP:** drops of any kind, renames, `ALTER COLUMN`, sequences, views,
domains as first-class migration citizens, drift *reporting* (tracked as
`dsqlbase inspect`, future).

---

## Pipeline

```
┌───────────────┐  ┌──────────────┐  ┌─────────────┐
│  validate     │→ │ introspect   │→ │ normalize   │
│ (local only)  │  │ (remote DB)  │  │ (remote →   │
│               │  │              │  │  serialized)│
└───────────────┘  └──────────────┘  └─────────────┘
                                            │
                                            ▼
                   ┌────────────────── reconcile ──────────────────┐
                   │                                               │
                   │   ┌─────────┐   ┌───────────┐   ┌─────────┐   │
                   │   │  diff   │ → │ translate │ → │  plan   │   │
                   │   │ (deltas)│   │ (rules →  │   │ (DAG +  │   │
                   │   │         │   │  ops +    │   │  layers)│   │
                   │   │         │   │  drift)   │   │         │   │
                   │   └─────────┘   └───────────┘   └─────────┘   │
                   └───────────────────────────────────────────────┘
                                            │
                                            ▼
                                    ┌──────────────┐
                                    │  print       │
                                    │  (AST → SQL) │
                                    └──────────────┘
                                            │
                                            ▼
                                    ┌──────────────┐
                                    │  execute     │
                                    │ (per-stmt,   │
                                    │  non-block)  │
                                    └──────────────┘
                                            │
                             ┌──────────────┴──────────────┐
                             │                             │
                             ▼                             ▼
                      [orchestrator waits          [orchestrator
                       on async job via             retries on
                       durable timer]               retryable err]
```

Every stage is a **pure, stateless function** of its inputs. No stage reads
from or writes to module-level state. This is a hard requirement because the
orchestrator (a Lambda Durable Function on deploy) may execute each stage in a
separate invocation, possibly across time boundaries.

The reconciler internally splits into three sub-stages — `diff`, `translate`,
`plan` — each exported independently so callers (or future tooling like
`dsqlbase inspect`) can use them in isolation. See [§5](#5-reconciler-reconciler).

```ts
validate(local):                  ValidationResult
introspect(session):              Promise<RemoteSchema>       // raw JSON
normalize(remote):                SerializedSchema            // unified shape

// Reconcile breaks into three pure sub-stages:
diff(local, remote):              SchemaDiff[]                // structural deltas
translate(diffs):                 { operations, drift }       // rules → tagged ops
plan(operations):                 OrderedPlan                 // DAG + layer order
// …wrapped together:
reconcile(local, remote):         ReconciliationResult        // { plan, drift }

print(statement, context?):       string                      // SQL
execute(session, statement):      Promise<ExecuteResult>      // single DDL
```

---

## 1. Runner (`runner.ts`)

The runner is the public API and the reference orchestrator for the
"one-shot" use case (CLI, local dev, simple deploys).

```ts
interface MigrationRunOptions {
  dryRun?: boolean;                 // print plan, don't execute
  abortOnWarning?: boolean;         // promote warnings to errors (CI mode)
  allowDestructive?: boolean;       // gate drop ops (post-MVP)
  onProgress?: (event: MigrationEvent) => void;   // stream stage/statement updates
}

interface MigrationResult {
  validation: ValidationResult;
  plan: OrderedPlan;                // full DAG, pre-filter
  drift: DriftNote[];               // unreconcilable state, informational only
  applied: ReconciliationOp[];      // what actually ran (minus dry-run / filtered)
  sql?: string[];                   // if dryRun
}

class MigrationRunner {
  constructor(private readonly session: Session) {}

  async run(definition: SerializedSchema, options?: MigrationRunOptions): Promise<MigrationResult>;

  // Stage-level entry points for durable-function orchestration.
  // Each is a thin wrapper around the standalone stage function; included
  // on the class purely for API ergonomics.
  validate(definition: SerializedSchema): ValidationResult;
  introspect(): Promise<RemoteSchema>;
  normalize(remote: RemoteSchema): SerializedSchema;
  reconcile(local: SerializedSchema, remote: SerializedSchema): ReconciliationResult;
  execute(statement: DDLStatement): Promise<ExecuteResult>;
}
```

The stage functions are also exported as free functions from their respective
modules. The class is sugar.

**Key invariant:** `run()` is safe to call repeatedly. If a prior run failed
partway through, the next call re-validates, re-introspects, re-reconciles, and
resumes from wherever reality diverges from the schema. No separate "retry" or
"recover" code path.

---

## 2. Validation (`validation/`)

Structural rules on the local schema, run before introspection. Zero DB calls.

### Error shape

```ts
interface ValidationIssue {
  level: "error" | "warning";
  code: string;         // stable identifier for filtering / suppression
  path: string[];       // e.g. ["users", "columns", "email"]
  message: string;
  hint?: string;
}

interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];      // derived: level === "error"
  warnings: ValidationIssue[];    // derived: level === "warning"
  isValid: boolean;               // errors.length === 0
}
```

### Rules

**Blocking (errors):**

| Code                          | Condition                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `TABLE_NO_PRIMARY_KEY`        | Table has neither a column-level PK nor a `PRIMARY_KEY_CONSTRAINT`.            |
| `DUPLICATE_NAME`              | Two tables in the same namespace, or two columns/indexes/constraints on a table, share a name. |
| `UNKNOWN_COLUMN_REFERENCE`    | PK / unique / index / check references a column not declared on the table.    |
| `EMPTY_CONSTRAINT_COLUMNS`    | PK or unique constraint has zero columns.                                      |
| `IDENTIFIER_TOO_LONG`         | Identifier exceeds 63 bytes (Postgres hard limit).                             |
| `UNSUPPORTED_TYPE`            | Column uses a type DSQL doesn't support (`money`, `xml`, `tsvector`, range/inherited types). |
| `FOREIGN_KEY_DECLARED`        | Schema includes a FK constraint; DSQL doesn't support FKs — relations are app-level. |
| `RELATION_TARGET_MISSING`     | Relation references a table/column not present in the schema bundle.           |
| `RESERVED_NAMESPACE`          | Schema bundle declares a namespace under the reserved `dsqlbase` prefix.       |

**Non-blocking (warnings):**

| Code                          | Condition                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `REDUNDANT_UNIQUE_ON_PK`      | Column is part of the PK and also has `.unique()`.                             |
| `DUPLICATE_INDEX_COVERAGE`    | Two indexes cover the same column set with identical options.                  |
| `UNQUOTED_IDENTIFIER_RISK`    | Identifier requires quoting (uppercase, reserved word) — works but surprise-prone. |
| `VARCHAR_WITHOUT_LENGTH`      | `varchar` declared without a length bound.                                     |
| `ORM_SIDE_CONSTRAINT_IGNORED` | Column declares `.notNull()` / `.default()` / `.check()` — flagged so users know these are ORM-enforced, not DB-enforced. |
| `NO_INDEX_ON_RELATION_FK`     | A declared relation FK column has no index — queries will likely seq-scan.     |

Behavior:

- `errors.length > 0` → `run()` throws before introspection.
- `warnings.length > 0` + `abortOnWarning: true` → same as errors.
- Otherwise warnings are included in `MigrationResult` and emitted via
  `onProgress`.

### Implementation sketch

The validator is a visitor keyed on `node.kind`. Each rule is a small function;
rules are registered in an array and applied in order. Makes rules easy to add,
test, and selectively disable.

```ts
type Rule<K extends NodeKind = NodeKind> = (
  node: SerializedObjectByKind<K>,
  schema: SerializedSchema,
) => ValidationIssue[];

const tableRules: Rule<"TABLE">[] = [
  requirePrimaryKey,
  checkDuplicateColumnNames,
  checkDuplicateIndexNames,
  validateConstraintColumnReferences,
  flagRedundantUniqueOnPk,
  flagOrmSideConstraints,
  // …
];
```

---

## 3. Introspection (`introspection.ts`)

The current query in `introspection.ts` already covers the right objects. It
needs three revisions to match the serialized-schema shape:

1. **Unify constraints into a single `constraints` array.** Currently unique
   and check constraints are siblings (`unique`, `checks`). Serialized tables
   have one `constraints: [{ kind: "UNIQUE_CONSTRAINT" | "CHECK_CONSTRAINT" | "PRIMARY_KEY_CONSTRAINT", … }]` array.
2. **Composite primary keys as a `PRIMARY_KEY_CONSTRAINT` entry.** Today the PK
   is inferred per-column via `a.attnum = ANY(con.conkey)`. That's fine for
   single-column PKs but loses ordering for composite PKs. Emit a dedicated
   `PRIMARY_KEY_CONSTRAINT` row in the `constraints` array whenever a PK
   exists, with `columns` ordered by `array_position(con.conkey, attnum)`.
3. **Drop the per-column `primaryKey: true` flag** in favor of reading it off
   the table-level `constraints`. Keeps one source of truth.

Schema-level concerns the query already handles correctly:
- Skips `pg_catalog`, `information_schema`, `sys`, `pg_toast`.
- Excludes primary-key indexes from the table `indexes` list (they're implicit
  in `CREATE TABLE`).
- Excludes indexes backing unique *constraints* from the `indexes` list (they
  show up as constraint entries instead).

The raw output is `RemoteSchema` (looser type — mirrors the pg_catalog JSON
shape). Normalization converts it to `SerializedSchema`.

---

## 4. Normalization (`normalizer.ts`)

Two responsibilities:

### 4a. Shape unification

Convert `RemoteSchema` → `SerializedSchema`. Mostly a renaming + wrapping pass:

- Merge table-level `unique[]`, `checks[]`, and the synthesized PK into
  `constraints[]` with kind tags.
- Wrap column check constraints as `CHECK_CONSTRAINT` objects.
- Normalize `distinctNulls: null` → `undefined` to match the definition DSL.
- Sort columns / indexes / constraints for stable diffing.

### 4b. Type normalization

`format_type()` output doesn't match the strings stored in
`ColumnDefinition.toJSON()`. A `normalizeType(s): string` helper maps both
sides to canonical forms.

| Canonical     | `format_type()`               | Local `dataType`              |
| ------------- | ----------------------------- | ----------------------------- |
| `uuid`        | `uuid`                        | `UUID`, `uuid`                |
| `text`        | `text`                        | `text`                        |
| `boolean`     | `boolean`                     | `boolean`                     |
| `integer`     | `integer`                     | `int`, `integer`              |
| `bigint`      | `bigint`                      | `bigint`                      |
| `varchar(N)`  | `character varying(N)`        | `varchar(N)`                  |
| `timestamptz` | `timestamp with time zone`    | `timestamp`, `datetime`       |
| `timestamp`   | `timestamp without time zone` | `timestamp without time zone` |
| `jsonb`       | `jsonb`                       | `json`                        |

Normalization is applied:

- Once, at the end of the normalizer pass, to every remote column's `dataType`.
- At comparison time in the reconciler, to every local column's `dataType` —
  the local toJSON output may carry user-provided casing/aliases.

The canonical form is lowercased and parenthesized identically on both sides,
so string equality is a safe comparison.

---

## 5. Reconciler (`reconciler/`)

The reconciler is the one stage big enough to internally split. It runs three
pure sub-stages — **diff → translate → plan** — each exported independently so
the runner (or future tooling like `dsqlbase inspect`) can invoke them in
isolation.

```
reconciler/
  index.ts        — exports diff, translate, plan, reconcile
  diff.ts         — structural comparison
  translate.ts    — rule engine
  plan.ts         — DAG + layering
  rules/          — one function per SchemaDiff.kind
```

### 5a. Diff (`diff.ts`) — structural comparison

Pure, mechanical, zero policy. Walks both normalized schemas and emits
structured deltas. Does not know about DSQL, operations, or rules.

```ts
type TableId = { schema: string; name: string };

type SchemaDiff =
  | { kind: "schema_missing_remote"; name: string }
  | { kind: "schema_missing_local";  name: string }
  | { kind: "table_missing_remote";  table: TableDef }
  | { kind: "table_missing_local";   table: RemoteTableDef }
  | { kind: "column_missing_remote"; table: TableId; column: ColumnDef }
  | { kind: "column_missing_local";  table: TableId; column: RemoteColumnDef }
  | { kind: "column_type_mismatch";
      table: TableId; column: string; local: string; remote: string }
  | { kind: "column_nullability_mismatch";
      table: TableId; column: string; localNotNull: boolean; remoteNotNull: boolean }
  | { kind: "column_default_mismatch";
      table: TableId; column: string; localDefault: string | null; remoteDefault: string | null }
  | { kind: "index_missing_remote";  table: TableId; index: IndexDef }
  | { kind: "index_missing_local";   table: TableId; index: RemoteIndexDef }
  | { kind: "unique_missing_remote"; table: TableId; constraint: UniqueDef }
  | { kind: "unique_missing_local";  table: TableId; constraint: RemoteUniqueDef };

function diff(local: SerializedSchema, remote: SerializedSchema): SchemaDiff[];
```

Every difference between the two schemas produces a diff entry, including
cases the migrator cannot act on (e.g. type mismatches). Filtering and
classification happen downstream.

The diff phase is what catches "remote state that didn't come from the
migrator" — a column already present with `NOT NULL`, a table with
user-added indexes we don't know about, a column with a different dataType.
These all surface as diff entries; whether they're reconcilable is the
translate phase's call.

### 5b. Translate (`translate.ts`) — rules that map diffs to operations

Takes `SchemaDiff[]` and applies a registry of rules to produce tagged
operations plus drift notes.

```ts
type OperationCategory = "create" | "drop" | "alter";
type OperationScope = "schema" | "table" | "column" | "index" | "constraint";

interface ReconciliationOp {
  id: string;                      // deterministic, e.g. "create_table:public.users"
  statement: DDLStatement;
  category: OperationCategory;
  scope: OperationScope;
  async: boolean;                  // statement triggers a DSQL async job
  dependsOn?: string[];            // prerequisite op ids
}

interface DriftNote {
  code: string;                    // e.g. "COLUMN_TYPE_MISMATCH"
  path: string[];
  message: string;
  detail?: Record<string, unknown>;
}

type RuleResult =
  | { kind: "operation"; op: ReconciliationOp }
  | { kind: "operations"; ops: ReconciliationOp[] }   // multi-output, e.g. unique→index+promote
  | { kind: "drift";     note: DriftNote }
  | { kind: "skip" };

type Rule<K extends SchemaDiff["kind"]> = (
  diff: Extract<SchemaDiff, { kind: K }>,
  context: TranslateContext,
) => RuleResult;

function translate(diffs: SchemaDiff[]): {
  operations: ReconciliationOp[];
  drift: DriftNote[];
};
```

Rules are registered per diff kind in `rules/`. Example mapping:

| Diff kind                      | Rule output                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `schema_missing_remote`        | op — `CREATE SCHEMA`, `{ category: "create", scope: "schema" }`                  |
| `schema_missing_local`         | op — `DROP SCHEMA`, `{ category: "drop", scope: "schema" }`                      |
| `table_missing_remote`         | op — `CREATE TABLE` (PK + types only), `{ category: "create", scope: "table" }`; plus one op per index and two per unique constraint |
| `table_missing_local`          | op — `DROP TABLE`, `{ category: "drop", scope: "table" }`                        |
| `column_missing_remote`        | op — `ALTER TABLE ADD COLUMN`, `{ category: "create", scope: "column" }`         |
| `column_missing_local`         | drift — `COLUMN_UNMANAGED` (DSQL forbids `DROP COLUMN`)                          |
| `column_type_mismatch`         | drift — `COLUMN_TYPE_MISMATCH` (DSQL forbids type change)                        |
| `column_nullability_mismatch`  | drift — `COLUMN_NULLABILITY_DIVERGES` (ORM contract takes over)                  |
| `column_default_mismatch`      | drift — `COLUMN_DEFAULT_DIVERGES` (ORM-side defaults)                            |
| `index_missing_remote`         | op — `CREATE INDEX ASYNC`, `{ category: "create", scope: "index", async: true }` |
| `index_missing_local`          | op — `DROP INDEX`, `{ category: "drop", scope: "index" }`                        |
| `unique_missing_remote`        | two ops — `CREATE UNIQUE INDEX ASYNC` + `ADD CONSTRAINT USING INDEX`, the second with `dependsOn` the first |
| `unique_missing_local`         | op — `DROP CONSTRAINT` (via `ALTER TABLE`), `{ category: "drop", scope: "constraint" }` |

Properties of the rule registry:

- **Extensible** — new DSQL capability or new diff kind adds a rule, nothing
  else changes.
- **Pluggable** (post-MVP) — third-party rule packages can override or extend
  the defaults.
- **No policy** — every op the registry *can* produce is produced. Filtering
  by `category`, `scope`, `async`, etc. is the runner's job.

### 5c. Plan (`plan.ts`) — DAG + layer assignment

Takes unordered `ReconciliationOp[]` and turns it into an ordered DAG with
layer indices:

```ts
interface OrderedPlan {
  nodes: ReconciliationOp[];
  edges: Array<{ from: string; to: string }>;   // op id → op id dependency
  layers: string[][];                            // layer index → op ids
}

function planOperations(operations: ReconciliationOp[]): OrderedPlan;
```

Layer assignment rules:

- An op's layer is `1 + max(layer of each dependsOn)`. Base layer is 0.
- Ops in the same layer are independent and *may* run in parallel.
- Ops across layers are strictly ordered: layer *N* must fully complete
  before layer *N+1* starts.

Default dependency edges (added beyond user-declared `dependsOn`):

1. `CREATE SCHEMA` → everything in that namespace.
2. `CREATE TABLE` → any op scoped to that table.
3. `ADD COLUMN` → any index/constraint that references the column.
4. `CREATE [UNIQUE] INDEX` → any `ADD CONSTRAINT … UNIQUE USING INDEX` that
   targets it.
5. Drop ops are scheduled in reverse: `DROP CONSTRAINT` before `DROP INDEX`
   before `DROP TABLE` before `DROP SCHEMA`. Drops come after creates within
   the same plan (so a rename-as-drop+create pair works correctly once renames
   arrive).

### 5d. `reconcile()` — composition

```ts
interface ReconciliationResult {
  plan: OrderedPlan;
  drift: DriftNote[];
}

function reconcile(local, remote): ReconciliationResult {
  const diffs = diff(local, remote);
  const { operations, drift } = translate(diffs);
  const plan = planOperations(operations);
  return { plan, drift };
}
```

### Runner strategy — tag-based filtering

The reconciler returns *every* op the rule registry can produce. The runner
decides what actually executes via its options:

```ts
function applyStrategy(plan, options): ReconciliationOp[] {
  return plan.nodes.filter(op => {
    if (op.category === "drop" && !options.allowDestructive) return false;
    // Future per-scope toggles: options.allowDrop?.tables, etc.
    return true;
  });
}
```

Execution walks layers in order. Within a layer, MVP runs sequentially; a
future orchestrator can parallelize.

### What the reconciler does NOT do

- **Does not filter by strategy.** Every producible op is in the plan; the
  runner filters.
- **Does not execute.** Output is an unexecuted plan.
- **Does not skip "already-applied" statements.** Idempotency comes from
  re-introspection; the reconciler is a pure function of (local, remote).
- **Does not emit DDL DSQL would refuse.** Operations DSQL cannot perform
  (`DROP COLUMN`, `ALTER COLUMN SET DATA TYPE`) become drift notes, not ops —
  even `allowDestructive: true` cannot execute them because there's nothing
  to execute.

---

## 6. Executor (`executor.ts`)

A single stateless primitive. One statement in, one classified result out.

```ts
type ExecuteResult =
  | { kind: "done" }
  | { kind: "pending"; jobId: string; operationHash: string }
  | { kind: "error"; retryable: boolean; cause: unknown };

async function executeStatement(
  session: Session,
  statement: DDLStatement,
  context?: Partial<SQLContext>,
): Promise<ExecuteResult>;
```

Responsibilities:

1. Print the statement via the DDL printer.
2. Send to the session.
3. Classify the response:
   - Sync DDL returned normally → `{ kind: "done" }`.
   - Async DDL (`CREATE INDEX ASYNC`) returned a `job_id` → `{ kind: "pending", jobId, operationHash }`. `operationHash` is derived from the printed SQL + target, used by the catalog for idempotent reconnection.
   - DSQL error → classified as `retryable: true` for `40001` / `OC001` /
     connection-level errors, `retryable: false` otherwise.

**Not responsibilities** (belong to the orchestrator):

- Waiting on async jobs. The executor does not call `sys.wait_for_job`.
- Retrying on retryable errors.
- Writing to the catalog.
- Skipping already-applied statements.

This keeps the executor usable as-is from:
- a synchronous CLI orchestrator (loops over statements, polls `sys.jobs`
  between each),
- a Lambda Durable Function (pauses the workflow between statements),
- a test harness (can mock at the statement level).

---

## 7. Concurrency & resumability — deferred

The MVP runner is **catalog-agnostic**. It holds no DB-side state, runs no
mutex, and does not try to skip "already-applied" statements via a persisted
ledger. Idempotency comes entirely from:

- **Re-introspection.** Every run rebuilds the plan from current DB state, so
  statements that previously succeeded drop out of the next plan naturally.
- **`IF NOT EXISTS`** on `CREATE SCHEMA` / `CREATE TABLE` / `ADD COLUMN` /
  `CREATE INDEX`. Single-statement re-runs are safe.
- **DSQL's OCC retries.** Concurrent writers collide at `40001`/`OC001`; the
  session client backs off and retries.

This is enough for the single-orchestrator case (CLI, single Lambda
invocation). It's **not** enough for the multi-orchestrator case — two
concurrent runs can submit duplicate `CREATE INDEX ASYNC` jobs, a crashed
Lambda mid-async-build leaves an orphan job the next invocation can't
reconnect to, etc.

Those concerns are deferred. The shape of the eventual solution is
orchestrator-specific, not runner-specific — so it belongs outside the runner
as a separate concern that different entry points compose on top:

- **CLI strategy** — fail-fast on a DB-side guard (likely a minimal "in
  progress" row). On collision, exit with a user-facing prompt to retry.
- **Lambda strategy** — register a callback id (provided by Durable
  Functions) in a queue-style catalog table on collision, then pause on the
  callback. The currently-running migration, on completion, checks the queue
  and signals the next waiter to resume.

Neither strategy is in the MVP. Both are additive: they wrap the runner, they
don't modify it. The runner's API stays `validate → introspect → normalize →
reconcile → execute` without knowing whether a catalog exists.

The same applies to async-job resumption across invocations (e.g. reconnecting
to an in-flight `sys.jobs` entry after a Lambda crash). For MVP, a crashed run
re-introspects on the next invocation; if the index is still mid-build, behavior
depends on DSQL's `CREATE INDEX IF NOT EXISTS` semantics under an in-flight
async job — flagged as an open question below.

---

## 8. Orchestration

Two orchestrators drive the stages in different environments. Both use the
same stage primitives; they differ only in how they handle waits and errors.

### In-process (CLI, local dev)

```
validation = validate(definition)
if validation.errors: throw

remote = await introspect(session)
local  = normalize(remote)
plan   = reconcile(definition, local)

for statement of plan:
  result = await execute(session, statement)
  if result.kind == 'pending':
    // Poll sys.jobs inline. Process stays alive for the duration.
    while true:
      await sleep(backoff(attempt++))
      status = await checkJob(session, result.jobId)
      if status == 'completed': break
      if status == 'failed': throw
  if result.kind == 'error' and result.retryable:
    await sleep(backoff(attempt++)); retry
```

### Lambda Durable Function

Same shape, but `sleep` is a durable timer (Lambda unloads during the wait)
and each stage is an activity (idempotent invocation, result persisted in the
workflow history):

```
validation = await activity(validate, definition)
remote     = await activity(introspect)
local      = await activity(normalize, remote)
plan       = await activity(reconcile, definition, local)

for statement of plan:
  result = await activity(execute, statement)
  if result.kind == 'pending':
    while true:
      await durableTimer(backoff(attempt++))    // Lambda unloads
      status = await activity(checkJob, result.jobId)
      if status == 'completed': break
      if status == 'failed': throw
  …
```

### Backoff

- Retryable DDL errors: start 2s, cap 60s, exponential.
- Async index polling: start 10s, cap 5 min, exponential. A multi-minute first
  poll is fine — non-trivial `CREATE INDEX ASYNC` on DSQL takes minutes, not
  milliseconds.

### Concurrency

Neither orchestrator guards against concurrent runs in the MVP — see
[§7](#7-concurrency--resumability--deferred). A second concurrent run relies
on `IF NOT EXISTS` and OCC retries to converge; any stronger guarantee is
orchestrator-specific and deferred.

---

## Why no DDL transactions

DSQL caps DDL at one statement per transaction. So:

- No atomicity gain from `BEGIN/COMMIT` around a single DDL — DSQL auto-commits
  anyway.
- No batching — can't group multiple DDLs for rollback.
- Explicit `BEGIN` just adds two round-trips.

The executor does **not** open explicit transactions for DDL. Each statement
is its own auto-commit.

**Failure semantics.** If statement N fails, statements `1..N-1` are committed;
the catalog records N as failed. The next `run()` re-introspects, re-reconciles
(producing a shorter plan — the applied statements are now reflected in the DB
introspection), and resumes from whatever's still missing. The reconciler is
idempotent because it's a pure function of local + remote state.

Re-introspection is the only consistency mechanism in the MVP. Any operational
state (async job tracking, mutex, queue) that a future orchestrator wants to
layer on top is DML that lives outside the runner — see
[§7](#7-concurrency--resumability--deferred).

---

## Prerequisites

Items that must land before the migrator is functional. Tracked separately
from the MVP implementation.

1. **`IndexDefinition` serializes column references.** Currently
   `.toJSON()` emits only `name` and `unique`. The migrator can't diff indexes
   without the column list.
2. **DDL AST: `UNIQUE USING INDEX` promotion node.** `AddConstraintSubAction`
   currently accepts only `CheckConstraintExpression`. Extend to accept a
   `UniqueUsingIndexConstraintExpression` variant (kind + `indexName` +
   `constraintName`), plus printer support.
3. **Composite PK in table-level `constraints`.** The table definition should
   emit a `PRIMARY_KEY_CONSTRAINT` entry for multi-column PKs rather than
   tagging each column. (See also the mirror change on the introspection side.)
4. **Session OCC retry.** The runner assumes the session handles `40001` /
   `OC001` retries. Confirm this is wired before using the runner in Lambda.

---

## Open questions

1. **Destructive opt-in granularity.** Single `allowDestructive: boolean`
   vs per-scope `allowDestructive: { tables?, indexes?, schemas?, constraints? }`.
   Leaning `boolean | { … }` union so simple cases stay simple and refinement
   doesn't need an API change.
2. **Parallel execution policy.** The plan is a DAG with explicit layers; MVP
   runs sequentially within a layer. When does parallelism become worth the
   error-handling complexity? Likely gated behind an explicit orchestrator flag
   when we have evidence of wall-time pain.
3. **Rule registry extensibility.** Third-party rule packages (overriding or
   extending defaults) — deferred or MVP? Pluggable adds surface area; fixed is
   easier to support but forces a PR for every new diff kind.
4. **`CREATE INDEX ASYNC` on empty tables.** DSQL might fast-path these; worth
   confirming so we don't over-budget poll backoff for what ends up sub-second.
5. **`CREATE INDEX IF NOT EXISTS` during an in-flight async build.** If a
   prior run submitted a `CREATE INDEX ASYNC` that hasn't finished, does
   `CREATE INDEX ASYNC IF NOT EXISTS` on the same name wait, error, or no-op?
   Answer determines whether MVP resumability is safe without catalog-backed
   job tracking.
6. **Op identity / dependency keys.** Op ids are stringly-typed
   (`"create_table:public.users"`). Fine for MVP; worth revisiting if cross-op
   coordination gets more complex.
