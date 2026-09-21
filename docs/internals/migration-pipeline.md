# Migration pipeline

_Audience: contributors and agents._

Source: `packages/migration/src/`. The runner is declarative — it diffs desired state against introspection with no memory of previous runs: no journal, no history table, no migration files.

```
validate  →  introspect  →  normalize  →  diff  →  operations  →  plan  →  execute
validation/  introspection/query.ts   normalizer.ts   reconciliation/diffs/  operations/  planner.ts  executor.ts
```

## Invariants

These hold across every layer. A change that breaks one needs a decision record.

1. **`SerializedSchema` is the contract** between introspection and reconciliation (`base.ts`). Local (`TableDefinition.toJSON()`) and remote (introspection query) must produce the same shape. Adapter logic lives in `introspection/normalizer.ts`, never in reconciliation.
2. **Diffs are dumb.** `reconciliation/diffs/*` has no knowledge of DSQL, refusals, or operation rules. It diffs every observable attribute (`hasDiff` is a recursive deep-equal) and emits raw `Diff` records.
3. **Operations are the policy layer.** `reconciliation/operations/*` translate diffs into DDL operations or refusals. All DSQL capability rules live here, and only here.
4. **Per-subject batching.** All diffs for one subject (a column, an index, a domain) collapse into one operation or one refusal carrying every blocked diff.
5. **Refusals are not errors.** A refusal is a structured record (`code`, `subject`, `diffs[]`, `message`) in `operations/base.ts`. The runner decides whether to fail on them; today `dryRun` / `run` throw `MigrationError`, `plan` returns them in `errors[]`.
6. **Ordering comes from `references[]`, not from kind.** Every operation declares the subjects it depends on; the planner is type-agnostic.
7. **`ORDERED_SCHEMA_OBJECTS = ["SCHEMA", "DOMAIN", "TABLE", "SEQUENCE"]`** drives create order; drops reverse it.

## Layers

### Introspection (`introspection/`)

One `pg_catalog` round trip (`query.ts`), unified `constraints[]` per table (PK / UNIQUE / CHECK), identity and generated columns via `pg_attribute.attidentity` / `attgenerated` + `pg_get_expr`. `normalizer.ts` does per-kind dispatch, column-level vs table-level constraint split, null → undefined coercion.

Known follow-up: PG normalizes CHECK expressions (`qty > 0` → `(qty > (0)::integer)`), so an equivalent local expression emits a `modify` diff → refusal. Normalizing local expressions in the adapter is the intended fix.

### Diffs (`reconciliation/diffs/`)

Per object: `column.ts`, `indexes.ts`, `constraint.ts`, `domain.ts`, `sequence.ts`; `table.ts` orchestrates. Column attributes (`generated`, `identity`, `check`) are diffed as whole-config keys.

### Operations (`reconciliation/operations/`)

What ships today on existing tables (see [DSQL capabilities](./dsql-capabilities.md) for what DSQL actually allows — several of these refusals are now stricter than necessary):

- Column add → bare `ADD COLUMN`; `unique: true` triggers the promotion path; `identity` adds `ALTER COLUMN … ADD IDENTITY` in the same statement; `notNull` / `defaultValue` / `check` / `primaryKey` / `generated` on an added column → `IMMUTABLE_COLUMN`.
- Column modify → refused (`IMMUTABLE_COLUMN`) except identity changes and `unique: false → true`.
- Column drop → `NO_DROP_COLUMN`.
- Index add → `CREATE INDEX [ASYNC]`; drop → `DROP INDEX RESTRICT`; modify → `IMMUTABLE_INDEX`.
- Constraints → refused (`IMMUTABLE_CONSTRAINT`) except UNIQUE adds, which use the promotion path: `CREATE UNIQUE INDEX ASYNC` then `ADD CONSTRAINT … UNIQUE USING INDEX`. The promotion is modelled as `type: CREATE, object: <UNIQUE_CONSTRAINT>` referencing `[table, index]`, which keeps the planner acyclic.
- Domain alters → only `defaultValue`; `dataType` / `notNull` / `check` → `IMMUTABLE_DOMAIN`.
- Sequence option changes → `ALTER SEQUENCE`.
- Drops default to `RESTRICT`; `safeOperations` flips them to `CASCADE` (misleading name, under review).

Refusal codes: `IMMUTABLE_COLUMN`, `NO_DROP_COLUMN`, `IMMUTABLE_CONSTRAINT`, `IMMUTABLE_DOMAIN`, `IMMUTABLE_INDEX`, `NO_FOREIGN_KEY`, `KIND_MISMATCH`.

### Planner (`reconciliation/planner.ts`)

Stable topological sort (Kahn's, min-id tiebreaker) over `IndexedDDLOperation[]`, inspecting only `id`, `type`, `references[]`. For CREATE/ALTER X: edges `dep → X`; for DROP X: edges `X → dep`. Subjects key on the qualified object name, or `qualifiedConstraintName(parentTable, constraint)` for standalone constraint ops. Cycles throw — they indicate a bug in operation emission, not user input.

Deferred: sequences before the tables that own them (`OWNED BY`). `SequenceDefinition.ownedBy()` is commented out in `packages/core/src/definition/sequence.ts` and the local/introspection serializations disagree; a one-line `references[]` change lands once that is fixed.

### Validation (`validation/`)

Imperative rules `(node, ctx) => void` keyed by `node.kind`, default registry inline in `validate.ts`. Errors: `TABLE_NO_PRIMARY_KEY`, `MULTIPLE_PRIMARY_KEYS`, `DUPLICATE_OBJECT_NAME`, `UNKNOWN_COLUMN_REFERENCE`, `EMPTY_CONSTRAINT_COLUMNS`, `IDENTIFIER_TOO_LONG` (63 UTF-8 bytes), `RESERVED_NAMESPACE`, `INVALID_SEQUENCE_CACHE`. Warnings: `REDUNDANT_UNIQUE_ON_PK`, `DUPLICATE_INDEX_COVERAGE`, `VARCHAR_WITHOUT_LENGTH`. Relations are not validated here (runtime-only). An `UNSUPPORTED_TYPE` rule was deliberately dropped: `dataType` is pinned at compile time.

### Runner and executor (`runner.ts`, `executor.ts`)

`MigrationRunner` exposes `validate` / `introspect` / `reconcile` / `plan` / `dryRun` / `run`. `run` is a sequential orchestrator; it awaits each operation, including async jobs, before the next. `OperationExecutor` prints per-op SQL, dispatches sync/async, and polls `sys.jobs` / `sys.wait_for_job`. **Async is detected by response shape** (a `{ job_id }` row), not by statement kind, so `DROP INDEX` and future async DDL need no special casing. `MigrationRunnerOptions extends Partial<DDLOperationOptions>` so `asyncIndexes` / `safeOperations` flow into operation factories — the seam that lets PGlite and DSQL share one runner.

Gates: invalid definitions throw from `plan` / `dryRun` / `run`; refusals throw from `dryRun` / `run`; destructive ops need `destructive: true`.

## Out of scope today (tracked, not forgotten)

Rename detection (a rename is add + refused drop), FK emission, view/function migration (AST kinds reserved), triggers, grants, online type changes via shadow column + backfill. The migrations proposal revisits these against the current DSQL grammar.

## Related

- [DSQL capabilities](./dsql-capabilities.md)
- [Architecture](./architecture.md)
- [Migrations (guide)](../guide/migrations.md)
- [Decision 0002 — migration consolidation](../decisions/0002-migration-consolidation.md)
