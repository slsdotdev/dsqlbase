---
proposal: migration-runner
epic: migration
story: 5
status: draft
owner: silviu
created: 2026-05-02
---

# Migration runner — execution model & API

## Problem

Story 5 in `.claude/epics/migration.md` was written assuming a CLI-shaped flow: a `MigrationExecutor` loops over planned operations and runs them one at a time inside `runner.run()`. That model breaks for two reasons that surfaced once we started thinking about real consumers:

1. **Durable execution.** The runner needs to be drivable from a durable host (Step Functions, Inngest, Temporal, durable Lambda). A durable host owns the loop and replays steps on retry. Each step it invokes must be a self-contained, deterministic call that returns a checkpointable record. A monolithic `run()` that does everything in one shot can't be re-entered after a partial failure.
2. **Async DDL.** `CREATE INDEX ASYNC` returns a `jobId` immediately and completes later. Treating it like a synchronous statement and waiting inline:
   - blocks the durable step, which costs money proportional to wall-clock time,
   - serializes async indexes that could have run in parallel.

So the runner needs a per-step API, and execution needs to know about async ops without leaking that knowledge into the planner.

## Architecture

The runner becomes the only public surface. `executor.ts` is deleted — its responsibility (per-op execution) collapses into a method on the runner.

Two consumer shapes, same primitives:

- **CLI mode** — `runner.run(definition, options)` orchestrates the whole pipeline in-process.
- **Durable mode** — the consumer calls each method as its own step and persists the returned values between steps.

```
                        ┌─────────────────┐
                        │ MigrationRunner │
                        └─────────────────┘
                                 │
   ┌──────────┬───────────┬──────┴──────┬──────────────────┬───────────────┐
   ▼          ▼           ▼             ▼                  ▼               ▼
validate  introspect  reconcile     plan(†)        executeOperation   awaitBatch
(sync)     (1 IO)     (sync)       (already in     (1 IO per op)     (1 IO step,
                                  reconcile)                          loops internally)

†: today `reconcileSchemas` returns the planned ops (planner runs inside it).
   Keeping it that way; we don't need a separate `plan()` entry.
```

### Why no executor

`MigrationExecutor` would be a thin object holding a `Session` and a method that takes one op and runs it. The runner already holds the session and is the only caller. A second class adds indirection without buying anything.

## Operation classification

Every `IndexedDDLOperation` is either **sync** or **async**. The classification is a function of the DDL statement, not a new field on the operation:

```ts
function isAsyncOperation(op: IndexedDDLOperation): boolean {
  return op.statement.__kind === "CREATE_INDEX" && op.statement.async === true;
}
```

For v1 this is the only async case. Adding more later is a one-line change.

## Progress model

Every per-op execution returns one shape, suitable for checkpointing:

```ts
type SyncProgress = {
  kind: "sync";
  opId: number;
  sql: string;
  status: "done";
};

type AsyncProgress = {
  kind: "async";
  opId: number;
  sql: string;
  jobId: string;
  status: "pending" | "done" | "failed";
  error?: string;
};

type OperationProgress = SyncProgress | AsyncProgress;
```

`opId` is the planner-assigned `IndexedDDLOperation.id`. Durable hosts use it as the step key.

## Async batching algorithm

Batching happens at execution time, not plan time. The planner stays type-agnostic; the runner walks the planned list and decides when to drain.

```
batch: AsyncProgress[] = []

for op of plan:
  if isAsyncOperation(op):
    progress = executeOperation(op)            // starts the async job, returns { jobId, pending }
    batch.push(progress)
  else:
    if batch.length: drained = awaitBatch(batch); batch = []
    executeOperation(op)                       // sync, returns { done }

if batch.length: awaitBatch(batch)
```

### Why this is correct

The planner already topo-sorts by `references[]`. Three cases:

1. **Async ↦ async, independent** — both pile into the batch, both run in parallel until a sync op (or end of list) drains them.
2. **Async ↦ sync, dependent** (UNIQUE promotion: `CREATE INDEX ASYNC` then `ADD CONSTRAINT … USING INDEX`) — the sync op forces a drain before it runs, so the index is ready when needed.
3. **Async ↦ sync, independent** — drain still happens. Slightly wasteful (we wait for an index we don't depend on) but bounded by the slowest job in the batch. Good enough for v1.

Async-depends-on-async doesn't occur in v1 (indexes only depend on tables; constraints depending on indexes are sync). If it ever does, the planner already keeps them in the right order — they'd just batch together and the second wouldn't actually start until the host yields and resumes, which is fine because the batch awaits both before any dependent sync op runs.

### Why not waves in the planner

Considered and rejected:

- Adds a new return shape (`Wave[]` instead of `IndexedDDLOperation[]`).
- Forces the planner to know which ops are async, which violates the "planner is type-agnostic" invariant from Story 3c.
- Doesn't actually save anything — the runner-level loop above produces the same execution graph.

## Async job tracker

The runner doesn't talk to `sys.jobs` (or whatever DSQL exposes) directly. It delegates to an `AsyncJobTracker`:

```ts
interface AsyncJobTracker {
  start(session: Session, op: IndexedDDLOperation, sql: string): Promise<{ jobId: string }>;
  poll(session: Session, jobIds: string[]): Promise<Map<string, "pending" | "done" | "failed">>;
  pollIntervalMs?: number;  // default 1000
}
```

Two implementations:

- **`NoopAsyncJobTracker`** (default) — executes the SQL synchronously; returns a synthetic `jobId` already in `done` state on the next poll. Suitable for PGlite tests where ASYNC isn't a real thing.
- **`DSQLAsyncJobTracker`** (later) — runs the statement, captures the returned job id, polls DSQL's job table. Lives behind a future flag; out of scope for this proposal.

The runner takes a tracker via constructor option; defaults to noop.

## Failure handling

For v1: trust the durable host's exactly-once-ish step semantics. If a step partially succeeds (DDL landed but the network dropped before the runner saw the OK), retry will surface the underlying "already exists" error and the migration aborts. Operator intervention required.

Re-introspect-on-retry is a v2 hardening. Documented as an open question.

Refusals (from `reconcile.errors[]`) abort before any execute call. No bypass flag.

## Public API

```ts
export interface MigrationRunnerOptions {
  /** Default false. Returns plan + statements, executes nothing. */
  dryRun?: boolean;
  /** Default false. If false, drops emitted by reconcile abort the run. */
  destructive?: boolean;
  /** Default NoopAsyncJobTracker. */
  asyncTracker?: AsyncJobTracker;
}

export interface DryRunResult {
  plan: IndexedDDLOperation[];
  statements: string[];           // printed SQL, in plan order
  errors: DDLOperationError[];    // refusals (will be empty if run() didn't throw)
}

export interface RunResult {
  plan: IndexedDDLOperation[];
  progress: OperationProgress[];  // one entry per executed op, in execution order
}

export class MigrationRunner {
  constructor(session: Session, options?: { asyncTracker?: AsyncJobTracker });

  // Sync, pure
  validate(definition: SerializedSchema): ValidationResult;

  // 1 IO call
  introspect(): Promise<SerializedSchema>;

  // Sync; planner runs inside reconcileSchemas
  reconcile(local: SerializedSchema, remote: SerializedSchema):
    { operations: IndexedDDLOperation[]; errors: DDLOperationError[] };

  // 1 IO call (sync DDL or async start). Returns checkpointable progress.
  executeOperation(op: IndexedDDLOperation): Promise<OperationProgress>;

  // 1 IO step (loops internally on pollInterval). Mutates input progresses in place
  // and also returns them, all with terminal status (done | failed).
  awaitBatch(batch: AsyncProgress[]): Promise<AsyncProgress[]>;

  // CLI orchestrator. Composes everything above.
  run(
    definition: SerializedSchema,
    options?: MigrationRunnerOptions
  ): Promise<RunResult | DryRunResult>;
}
```

### `run()` body (CLI mode)

```ts
async run(definition, options = {}) {
  const validation = this.validate(definition);
  if (!validation.isValid) throw new ValidationError(validation.errors);

  const remote = await this.introspect();
  const { operations, errors } = this.reconcile(definition, remote);

  if (errors.length > 0) throw new ReconciliationError(errors);

  const printer = createPrinter();
  const statements = operations.map((op) => printer(op.statement));

  if (options.dryRun) {
    return { plan: operations, statements, errors: [] };
  }

  const progress: OperationProgress[] = [];
  let batch: AsyncProgress[] = [];

  for (const op of operations) {
    const p = await this.executeOperation(op);
    progress.push(p);

    if (p.kind === "async") {
      batch.push(p);
    } else if (batch.length > 0) {
      await this.awaitBatch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await this.awaitBatch(batch);

  return { plan: operations, progress };
}
```

### Durable mode (consumer-side sketch)

```ts
const validation = runner.validate(definition);            // local, no step needed
if (!validation.isValid) throw …;

const remote = await ctx.step("introspect", () =>
  runner.introspect()
);

const { operations, errors } = runner.reconcile(definition, remote);  // deterministic
if (errors.length > 0) throw …;

let batch = [];
for (const op of operations) {
  const p = await ctx.step(`op-${op.id}`, () => runner.executeOperation(op));
  if (p.kind === "async") batch.push(p);
  else if (batch.length > 0) {
    await ctx.step(`drain-${op.id}`, () => runner.awaitBatch(batch));
    batch = [];
  }
}
if (batch.length > 0) await ctx.step("drain-final", () => runner.awaitBatch(batch));
```

The durable host memoizes step results. On replay, completed steps return their stored progress; only the one that crashed re-runs.

## Tests

`packages/schema/src/migration/runner.test.ts` (new file). Mock `Session` plus a fake `AsyncJobTracker` that lets tests control job-status transitions.

Cases:

- **Validation error aborts** — invalid definition → `run()` throws, no IO.
- **Reconciliation error aborts** — definition triggers a refusal → `run()` throws, no execute calls.
- **Dry run** — returns plan + statements; session is never called.
- **Sync only** — three sync ops; assert execute order, all return `kind: "sync"`.
- **Async batching: consecutive async** — two `CREATE INDEX ASYNC` then a sync op; assert both starts happen before any drain, then one `awaitBatch` covers both, then sync runs.
- **Async then sync, dependent** — UNIQUE promotion path: `CREATE INDEX ASYNC` + `ADD CONSTRAINT … USING INDEX`; assert drain happens before the constraint adds.
- **Trailing async** — final ops are async; assert a drain runs at end.
- **Async failure** — tracker reports `failed` for one job in a batch; assert `awaitBatch` throws and `run()` propagates.
- **Per-step replay shape** — call `executeOperation` directly, assert returned progress shape (sync vs async, jobId present for async).

`packages/tests` (Story 6, separate) covers the PGlite end-to-end paths.

## Out of scope / open questions

- **Re-introspect-on-retry.** Partial-failure recovery. v2.
- **Real DSQL job tracker.** Wire up against real DSQL once we have an integration target. Today's noop is enough for unit + PGlite tests.
- **Resumable plans.** Persisting the plan across runner instances so a durable host can resume mid-migration without re-introspecting. The progress model supports it, but we don't ship the persistence layer in v1.
- **Cancellation.** No cooperative cancel API in v1.
- **Pacing / throttling async polls.** Fixed `pollIntervalMs` in v1; backoff later if needed.
