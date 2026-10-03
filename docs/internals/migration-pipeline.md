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
2. **Diffs are dumb.** `reconciliation/diffs/*` has no knowledge of DSQL, refusals, or operation rules. It diffs every observable attribute (`hasDiff` is a recursive deep-equal) and emits raw `Diff` records. Some attributes need an equality that knows their spelling — defaults (`diffs/expression.ts`), sequence options — and those comparisons live here too; deciding what to _do_ about a difference does not.
3. **Operations are the policy layer.** `reconciliation/operations/*` translate diffs into DDL operations or refusals. All DSQL capability rules live here, and only here.
4. **Per-subject batching.** All diffs for one subject (a column, an index, a domain) collapse into one operation or one refusal carrying every blocked diff.
5. **Refusals are not errors.** A refusal is a structured record (`code`, `subject`, `diffs[]`, `message`) in `operations/base.ts`. The runner decides whether to fail on them; today `dryRun` / `run` throw `MigrationError`, `plan` returns them in `errors[]`.
6. **Ordering comes from `references[]`, not from kind.** Every operation declares the subjects it depends on; the planner is type-agnostic.
7. **`ORDERED_SCHEMA_OBJECTS = ["SCHEMA", "DOMAIN", "TABLE", "SEQUENCE"]`** drives create order; drops reverse it.

## Layers

### Introspection (`introspection/`)

One `pg_catalog` round trip (`query.ts`), unified `constraints[]` per table (PK / UNIQUE / CHECK), identity and generated columns via `pg_attribute.attidentity` / `attgenerated` + `pg_get_expr`. `normalizer.ts` does per-kind dispatch, column-level vs table-level constraint split, null → undefined coercion.

The normalizer also clears a primary key's `include` when it lists every non-key column: on DSQL the key's index covers the whole row, columns added later included, without anything declaring it.

PostgreSQL prints expressions back deparsed, so they don't round-trip as written. **Defaults** compare through `sameDefault` (`reconciliation/diffs/expression.ts`):

- keyword case outside quotes is ignored;
- a literal's cast is ignored (`'EUR'` = `'EUR'::text`);
- a number compares quoted or bare;
- a `json` / `jsonb` literal compares by value.

A default whose spelling these rules don't cover (a timestamp literal, printed in the session's time zone) re-plans as changed; it never goes unnoticed. **CHECK expressions are compared by name only**, so a changed expression under the same name isn't detected. The planned migration state (a snapshot of the last applied definition) is the intended fix for both.

### Diffs (`reconciliation/diffs/`)

Per object: `column.ts`, `indexes.ts`, `constraint.ts`, `domain.ts`, `sequence.ts`; `table.ts` orchestrates. Column attributes (`generated`, `check`) are diffed as whole-config keys; `identity` by its effective state; `defaultValue` through `sameDefault`.

### Operations (`reconciliation/operations/`)

What ships today on existing tables (see [DSQL capabilities](./dsql-capabilities.md) for what DSQL actually allows — several of these refusals are now stricter than necessary):

- Column add → bare `ADD COLUMN`; `unique: true` triggers the promotion path; `identity` adds `ALTER COLUMN … ADD IDENTITY` in the same statement; `notNull` / `defaultValue` / `check` / `primaryKey` / `generated` on an added column → `IMMUTABLE_COLUMN`.
- Column modify → refused (`IMMUTABLE_COLUMN`) except identity changes and `unique: false → true`.
- Column drop → `NO_DROP_COLUMN`.
- Index add → `CREATE INDEX [ASYNC]`; drop → `DROP INDEX RESTRICT`; modify → `IMMUTABLE_INDEX`.
- Constraints → refused (`IMMUTABLE_CONSTRAINT`) except UNIQUE adds, which use the promotion path: `CREATE UNIQUE INDEX ASYNC` then `ADD CONSTRAINT … UNIQUE USING INDEX`. The promotion is modelled as `type: CREATE, object: <UNIQUE_CONSTRAINT>` referencing `[table, index]`, which keeps the planner acyclic.
- Domain alters → only `defaultValue`; `dataType` / `notNull` / `check` → `IMMUTABLE_DOMAIN`.
- Sequence option changes → `ALTER SEQUENCE`.
- Drops are always `RESTRICT`; `safeOperations` only adds `IF EXISTS`. A table drop references the domains its columns use, so a domain dropped in the same plan comes after the table.
- `CREATE TABLE` carries identity columns (with `SEQUENCE NAME` when the definition names one) and generated columns inline.
- Sequence and identity options compare by their effective values: an option the definition leaves unset counts as the PostgreSQL default for a `bigint` sequence, and an identity's sequence name only counts when the definition names one. `ALTER SEQUENCE` lists only the options that changed. `ownedBy` isn't compared (deferred).
- Key-column lists (index, primary key, unique) compare in order; `include` lists compare as sets. A constraint whose kind changes under the same name is removed and added.

Refusal codes: `IMMUTABLE_COLUMN`, `NO_DROP_COLUMN`, `IMMUTABLE_CONSTRAINT`, `IMMUTABLE_DOMAIN`, `IMMUTABLE_INDEX`, `NO_FOREIGN_KEY`, `KIND_MISMATCH`.

### Planner (`reconciliation/planner.ts`)

Stable topological sort (Kahn's, min-id tiebreaker) over `IndexedDDLOperation[]`, inspecting only `id`, `type`, `references[]`. For CREATE/ALTER X: edges `dep → X`; for DROP X: edges `X → dep`. Subjects key on the qualified object name, or `qualifiedConstraintName(parentTable, constraint)` for standalone constraint ops. Cycles throw — they indicate a bug in operation emission, not user input.

Deferred: sequences before the tables that own them (`OWNED BY`). `SequenceDefinition.ownedBy()` is commented out in `packages/core/src/definition/sequence.ts` and the local/introspection serializations disagree; a one-line `references[]` change lands once that is fixed.

### Validation (`validation/`)

Imperative rules `(node, ctx) => void` keyed by `node.kind`, default registry inline in `validate.ts`. Errors: `TABLE_NO_PRIMARY_KEY`, `MULTIPLE_PRIMARY_KEYS`, `DUPLICATE_COLUMN_NAME`, `DUPLICATE_OBJECT_NAME`, `DUPLICATE_SEQUENCE_NAME` (an identity's explicit sequence name already used in its namespace), `UNKNOWN_COLUMN_REFERENCE`, `EMPTY_CONSTRAINT_COLUMNS`, `IDENTIFIER_TOO_LONG` (63 UTF-8 bytes), `RESERVED_NAMESPACE`, `INVALID_SEQUENCE_CACHE`. Warnings: `REDUNDANT_UNIQUE_ON_PK`, `DUPLICATE_INDEX_COVERAGE`, `VARCHAR_WITHOUT_LENGTH`. Relations are not validated here (runtime-only; `SchemaRegistry` checks their column pairs when the client is built). Several rules restate something the high-level builders already reject at declaration time — `validate` also accepts a `SerializedSchema` that never went through them. An `UNSUPPORTED_TYPE` rule was deliberately dropped: `dataType` is pinned at compile time.

### Runner and executor (`runner.ts`, `executor.ts`)

`MigrationRunner` exposes `validate` / `introspect` / `reconcile` / `plan` / `dryRun` / `run`. `run` is a sequential orchestrator; it awaits each operation, including async jobs, before the next. `OperationExecutor` prints per-op SQL, dispatches sync/async, waits with `CALL sys.wait_for_job(id)` (a procedure returning `{ succeeded }`), and reads `sys.jobs` by its snake_case columns for the job's type and failure details. **Async is detected by response shape** (a `{ job_id }` row), not by statement kind, so `DROP INDEX` and future async DDL need no special casing. `MigrationRunnerOptions extends Partial<DDLOperationOptions>` so `asyncIndexes` / `safeOperations` flow into operation factories — the seam that lets PGlite and DSQL share one runner.

Gates: invalid definitions throw from `plan` / `dryRun` / `run`; refusals throw from `dryRun` / `run`; destructive ops need `destructive: true`.

## Out of scope today (tracked, not forgotten)

Rename detection (a rename is add + refused drop), FK emission, view/function migration (AST kinds reserved), triggers, grants, online type changes via shadow column + backfill. The migrations proposal revisits these against the current DSQL grammar.

## Related

- [DSQL capabilities](./dsql-capabilities.md)
- [Architecture](./architecture.md)
- [Migrations (guide)](../guide/migrations.md)
- [Decision 0002 — migration consolidation](../decisions/0002-migration-consolidation.md)
