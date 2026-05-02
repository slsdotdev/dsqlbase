# Story 3c — Operation Planner: implementation plan

Status: draft, pre-implementation
Scope: `packages/schema/src/migration/reconciliation/`

## Core idea

The planner is a pure topological reorder over already-emitted ops. It is **type-agnostic**: it never inspects `object.kind` and has no per-kind ordering rules. It only uses three things on each `IndexedDDLOperation`:

- `id` (emission order, also a stable tiebreaker)
- `references: string[]` (subjects this op depends on)
- `type` (`CREATE` / `ALTER` / `DROP`)

Hardcoded rules from the epic spec ("schemas before namespaced objects", "domains before tables", "sequences before tables that own them") collapse into a single principle: **each op declares its dependencies via `references[]`**, and the planner resolves them. The few places where an op currently fails to declare its dependencies are bugs we'll fix as part of 3c (see "Gaps in operations" below).

## Algorithm

A stable topological sort with emission order as tiebreaker.

For every emitted op `X`:

- If `X.type ∈ {CREATE, ALTER}`: for each `ref ∈ X.references`, add edge `op → X` for every op `op` that touches subject `ref`. (X must come after them.)
- If `X.type = DROP`: for each `ref ∈ X.references`, add edge `X → op` for every op `op` that touches subject `ref`. (X must come before them.)

Then Kahn's algorithm with a min-heap keyed on original `id` yields a stable order. Detect cycles and throw with a helpful message (cycles would indicate a bug in operation emission, not user input).

The simpler "anchor = max(lastIdOfRefs) + ε" formulation **does not handle transitive dependencies** (A→B→C with C emitted last collapses A and B at the wrong relative positions), so we use real topo sort.

## File layout

- New: `packages/schema/src/migration/reconciliation/planner.ts`
  - `export function planOperations(ops: IndexedDDLOperation[]): IndexedDDLOperation[]`
  - Pure function, builds its own subject→ids registry from the input
- New: `packages/schema/src/migration/reconciliation/planner.test.ts`
- Modified: `reconcile.ts` — call `planOperations` on `_operations` before returning. Remove the now-unused `_operationRegistry` / `_registerOperation` (the planner reconstructs it).
- Modified: `operations/base.ts` — add `qualifiedConstraintName(parentTable, constraint)` helper.

## Registry keying

The registry maps **subject string → list of ids**. The subject string for an op is whatever name will appear in _other ops'_ `references[]`. Today that's:

- Schema / table / domain / sequence / index: `qualifiedName(op.object)` (`ns.name` or `name`).
- Promotion-path constraint (`UNIQUE_CONSTRAINT` object emitted as a CREATE): use `qualifiedConstraintName(parentTableQualifiedName, constraint.name)`. No op references constraints today, so the practical effect is just collision avoidance — two tables with `x_pkey`-style names won't share a registry slot.

The planner needs the parent table to compute the constraint key. The simplest source of truth: the constraint op's `references[]` already contains `[tableName, indexName]` (from `uniquePromotionOps`). Pull `references[0]` as the parent for keying. Document this convention in `planner.ts`.

## Gaps in operations to close as part of 3c

Each op must declare _every_ subject it depends on in `references[]`. Audit findings:

1. **`createIndexOperation` / `uniquePromotionOps`** — both reference the table by `tableName` which the caller threads through. In `diffTableOperations` the caller passes `qualifiedName(local)`, so this is correct. ✓ No fix needed, just verify in tests.
2. **`createSequenceOperation`** — if `options.ownedBy` is set, push the owning table's qualified name into `references[]`. Today only the namespace is referenced. This is the one place where the "OWNED BY" rule from the epic actually needs operation-side support; once added, the planner needs no special case.
3. **`createDomainOperation`, `createTableOperation`** — already declare their namespace via `maybeNamespaceReference`. Tables also push column domain names. ✓
4. **Promotion-path constraint op** — references `[tableName, indexName, ...namespace]`. ✓

## `reconcile.ts` change

```ts
public run() {
  // ...existing emission loop unchanged, but drop _operationRegistry...
  return {
    operations: planOperations(this._operations),
    errors: this._errors,
  };
}
```

`reconcileSchemas` signature unchanged. Order in the returned `operations` is now planned, not raw emission order.

## Tests — `planner.test.ts`

Each case feeds a handcrafted `IndexedDDLOperation[]` (or, for a couple integration cases, drives via `reconcileSchemas`) and asserts on the resulting `id` sequence:

- **Refs respected (CREATE)**: emit `[index(refs=[t]), table(t)]` → planner returns `[table, index]`.
- **Refs respected (DROP)**: emit `[dropTable(t), dropIndex(refs=[t])]` → returns `[dropIndex, dropTable]`.
- **Transitive**: emit `[A(refs=[B]), B(refs=[C]), C]` → returns `[C, B, A]`.
- **Schema before namespaced table**: `references: [ns]` on the table.
- **Domain before column add**: ALTER TABLE op carries domain in `references`.
- **UNIQUE promotion chain**: CREATE TABLE → CREATE INDEX → CREATE constraint, where constraint refs `[table, index]`.
- **Sequence OWNED BY ordering**: requires the `createSequenceOperation` fix above; one-time assertion.
- **Stable within same subject**: two ALTERs on one subject keep emission order.
- **Independent ops keep emission order**: dropping old index + creating new unrelated table interleave per emission.
- **Cycle detection**: synthetic cyclic references throws.

Plus update `reconcile.test.ts` only if existing assertions break under the new order — the three current cases each have a single op so they don't.

## Acceptance

- `npm test -w @dsqlbase/schema` green (new planner suite + existing reconcile suite).
- No new exports from `operations/index.ts`; planner is `reconciliation/planner.ts` and is wired only from `reconcile.ts`.
- `_operationRegistry` field removed from `SchemaReconciler` (planner owns it now).

## Note on the line highlighted in the epic

> "Sequences before tables that own them (via `OWNED BY`)"

Per the 3c kickoff clarifications, this rule is **deleted from the planner spec**. It becomes a one-line addition in `createSequenceOperation` (push `ownedBy.table` into `references[]`) — the planner then orders correctly without knowing what a sequence or `OWNED BY` is. Same shape applies to every other ordering rule in the epic's 3c bullet list: each is subsumed by `references[]` on the relevant op.
