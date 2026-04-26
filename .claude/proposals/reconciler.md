# Schema Reconciler — Design Proposal

## Overview

The reconciler computes, given a local schema and a remote schema (both already
normalized and validated), the set of actions needed to bring the remote into
conformance with the local — and, for actions that DSQL will not allow, an
explicit refusal explaining why.

It is a **pure function**. No DB calls, no I/O, no policy decisions about what
to actually run. The runner ([`migrations-module-mvp.md`](./migrations-module-mvp.md))
composes this into the larger pipeline.

```
reconcile(local, remote) → { operations, refusals, plan }
```

**Local is the source of truth.** Throughout, `add` means "missing from remote,"
`remove` means "missing from local," `modify` means "value diverges between the
two." Both inputs have already passed through normalization, so shapes are
directly comparable.

---

## Pipeline

Three sub-stages, each exported independently:

```
┌────────┐   ┌───────────┐   ┌────────┐
│  diff  │ → │ translate │ → │  plan  │
└────────┘   └───────────┘   └────────┘
```

```ts
diff(local, remote):       Diff[]                         // structural deltas
translate(diffs):          { operations, refusals }       // actions → ops or refusals
plan(operations):          OrderedPlan                    // topo-sorted DAG

// composed:
reconcile(local, remote): { plan, refusals }
```

The split exists so future tooling (e.g. a `dsqlbase inspect` command) can use
`diff` or `translate` in isolation without dragging in planning.

---

## 1. Diff (`diffs.ts`)

Walks both schemas and emits one entry per *action* that the remote needs to
take to match local. Object-shape only — does not know about DSQL, operations,
or rules.

### Shape

```ts
type DiffType = "add" | "remove" | "modify";

interface Diff<T extends SerializedObject<DefinitionNode>> {
  type: DiffType;
  kind: T["kind"];
  name: T["name"];
  key?: keyof T;          // for modify: which property changed
  value?: T[keyof T];     // local value (or full object for add/remove)
  previousValue?: T[keyof T];   // remote value, for modify
}
```

Semantics:

- **`add`** — object exists in local, missing from remote. `value` carries the
  full local object.
- **`remove`** — object exists in remote, missing from local. `value` carries
  the full remote object.
- **`modify`** — both sides exist, one or more properties differ. One diff per
  changed property; `key` names it, `value` is local, `previousValue` is remote.

### What the diff function does NOT do

- **Does not carry parent context.** `diffColumn` describes a column action;
  knowing which table the column belongs to is the caller's job. `diffTable`
  composes by calling `diffColumn` and attaching context as it constructs the
  larger result.
- **Does not classify.** Every action gets emitted. Whether DSQL can perform
  it, whether it's destructive, whether it's reconcilable at all — translate's
  call.
- **Does not infer renames.** Renames look like remove+add and are
  indistinguishable without an intent signal from the user (see [§4](#4-renames)).

### Per-object diffs

One function per object kind: `diffColumn`, `diffIndex`, `diffConstraint`,
`diffTable`, `diffSchema`. Each returns `Diff[]` for the differences *within
that object*. `diffTable` walks columns/indexes/constraints and aggregates;
`diffSchema` walks tables and aggregates.

The `Diff<T>` shape is parametric over the object kind, so adding a new
top-level object type (sequences, views, …) means writing one more `diffX`
function — not extending a discriminated union.

---

## 2. Translate (`translate.ts`)

Takes `Diff[]` and produces operations (DDL we will run) plus refusals (DDL
DSQL will not allow). One rule per `(kind, type)` pair, registered in a table.

### Operations

```ts
type OperationCategory = "create" | "drop" | "alter";
type OperationScope = "schema" | "table" | "column" | "index" | "constraint";

interface ReconciliationOp {
  id: string;                      // stable, e.g. "create_table:public.users"
  statement: DDLStatement;         // AST node, rendered later by the printer
  category: OperationCategory;
  scope: OperationScope;
  async: boolean;                  // statement triggers a DSQL async job
  dependsOn?: string[];            // prerequisite op ids
}
```

A single diff may translate to multiple ops. A unique-constraint add, for
example, becomes `CREATE UNIQUE INDEX ASYNC` + `ADD CONSTRAINT … USING INDEX`,
the second `dependsOn` the first. That two-op chain is an implementation
detail of the translator — the diff itself just says "add unique constraint."

### Refusals

When a diff describes an action DSQL cannot perform (drop column, change
column type, drop schema with dependents, etc.), the translator emits a
**refusal** instead of an operation. Refusals exist so the user gets a clear
"we noticed this and here's why we can't act" message, not a silent skip.

```ts
interface Refusal {
  action: DiffType;                // what the user (effectively) asked for
  object: { kind: string; path: string[] };   // what it applied to
  reason: {
    code: string;                  // stable, e.g. "DSQL_NO_DROP_COLUMN"
    message: string;               // human-readable
  };
  detail?: Record<string, unknown>;
}
```

Stable reason codes for MVP:

| Code                        | Triggered by                                          |
| --------------------------- | ----------------------------------------------------- |
| `DSQL_NO_DROP_COLUMN`       | column `remove` diff                                  |
| `DSQL_NO_COLUMN_TYPE_CHANGE`| column `modify` on `dataType`                         |
| `DSQL_NO_ALTER_NOT_NULL`    | column `modify` on `notNull` (ORM-side enforcement)   |
| `DSQL_NO_ALTER_DEFAULT`     | column `modify` on `defaultValue` (ORM-side)          |
| `RENAME_REQUIRES_INTENT`    | matched remove+add pair the differ won't infer (post-MVP) |

Refusals are returned alongside operations, **not mixed into them**. The runner
surfaces refusals to the user and proceeds with whatever operations are
executable.

### Output

```ts
function translate(diffs: Diff[]): {
  operations: ReconciliationOp[];
  refusals: Refusal[];
};
```

---

## 3. Plan (`plan.ts`)

Topologically sorts operations by `dependsOn`. MVP returns a flat sequential
order; layered/parallel execution is deferred until there's wall-time evidence
that it's worth the error-handling complexity.

```ts
interface OrderedPlan {
  nodes: ReconciliationOp[];       // sorted; safe to execute in array order
  edges: Array<{ from: string; to: string }>;   // for inspection / debugging
}

function plan(operations: ReconciliationOp[]): OrderedPlan;
```

Default dependency edges (added beyond user-declared `dependsOn`):

1. `CREATE SCHEMA` → everything in that namespace.
2. `CREATE TABLE` → any op scoped to that table.
3. `ADD COLUMN` → any index/constraint that references the column.
4. `CREATE [UNIQUE] INDEX` → any `ADD CONSTRAINT … UNIQUE USING INDEX` on it.
5. Drops are scheduled in reverse: `DROP CONSTRAINT` before `DROP INDEX` before
   `DROP TABLE` before `DROP SCHEMA`. Drops follow creates within the same plan.

A cycle is a bug — fail loudly.

---

## 4. Renames

Renames cannot be inferred from a diff: `{ remove: old_name, add: new_name }`
is structurally indistinguishable from a delete-plus-create. They require an
intent signal from the user — e.g. `renameFrom: "old_name"` on the local
definition.

When the local schema lacks that signal and the differ sees an unmatched
remove + add on the same parent, MVP emits both diffs as-is. The remove
becomes a refusal (`DSQL_NO_DROP_*`); the add becomes an op. The user sees
both and can fix the source.

Native rename support is post-MVP. When it arrives, the differ pairs annotated
removes with adds and emits a single `modify` (or a dedicated `rename` action,
TBD).

---

## 5. Primary keys

Two valid shapes:

- **Single-column PK** — `primaryKey: true` on the column. Diff'd at the column
  level.
- **Composite PK** — `PRIMARY_KEY_CONSTRAINT` entry in the table-level
  `constraints` array, with ordered columns. Diff'd at the constraint level.

Local definitions already support both. Introspection currently only emits the
per-column form; the query needs updating to emit composite PKs as constraint
entries with `array_position(con.conkey, attnum)` ordering. Tracked as a
prerequisite.

---

## What the reconciler does NOT do

- **Does not validate.** Inputs are assumed valid. Validation is upstream.
- **Does not normalize.** Inputs are assumed normalized. Normalization is
  upstream.
- **Does not execute or print SQL.** Operations carry AST nodes; the executor
  drives the printer.
- **Does not filter by policy.** Every producible op is in the plan; the
  runner gates `destructive` ops, etc.
- **Does not skip "already-applied" statements.** Idempotency comes from
  re-introspection on the next run; the reconciler is a pure function of
  (local, remote).

---

## Open questions

1. **Op identity.** Stringly-typed ids (`"create_table:public.users"`) are
   fine for MVP. Revisit if cross-op coordination gets complex.
2. **Refusal granularity.** One refusal per diff, or coalesce related ones
   (e.g. five column type-change refusals on the same table → one refusal with
   a list)? Leaning per-diff for MVP — simpler, and the runner can group at
   render time.
3. **Rename action shape.** When renames land, do they replace a remove+add
   pair with a `modify` (reusing the existing type) or get their own action
   (`rename`, with `previousName`)? Probably the latter — renames have
   different downstream semantics.
4. **Diff coverage of unsupported types.** If a column's local `dataType` is
   something DSQL doesn't accept, validation should have caught it — but if it
   slips through, the translator currently has no rule and would silently drop
   the diff. Worth a default "unhandled diff → refusal with `UNHANDLED_DIFF`"
   fallback.
