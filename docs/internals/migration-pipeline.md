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
4. **Changes and steps.** All diffs for one target (a column, an index, a constraint) collapse into one decision: a refusal carrying every blocked diff, or a **change** of one or more **steps**. Each step is one operation, one statement, one transaction: statements are never batched into a shared `ALTER TABLE`. Every operation carries a `summary` (`operations/base.ts`: change key, step i/n, subject, action, target, attribute changes, risk, async), built with `change(key, drafts)`.
5. **Refusals are not errors.** A refusal is a structured record (`code`, `subject`, `diffs[]`, `message`) in `operations/base.ts`. The runner decides whether to fail on them; today `dryRun` / `run` throw `MigrationError`, `plan` returns them in `errors[]`.
6. **Ordering comes from `references[]`, not from kind.** Every operation declares the subjects it depends on; the planner is type-agnostic.
7. **`ORDERED_SCHEMA_OBJECTS = ["SCHEMA", "DOMAIN", "TABLE", "SEQUENCE"]`** drives create order; drops reverse it.

## Layers

### Introspection (`introspection/`)

One `pg_catalog` round trip (`query.ts`), unified `constraints[]` per table (PK / UNIQUE / CHECK), identity and generated columns via `pg_attribute.attidentity` / `attgenerated` + `pg_get_expr`. `normalizer.ts` does per-kind dispatch, column-level vs table-level constraint split (a one-column PRIMARY KEY or CHECK collapses onto its column; a UNIQUE stays at the table level so its name survives), null → undefined coercion. It reads `pg_constraint.convalidated` as a CHECK's `validated` and `pg_index.indisvalid` as an index's `valid`: a definition always says `true`, so a constraint left `NOT VALID` or an index whose async build failed shows up as a difference.

The normalizer also clears a primary key's `include` when it lists every non-key column: on DSQL the key's index covers the whole row, columns added later included, without anything declaring it.

PostgreSQL prints expressions back deparsed, so they don't round-trip as written. **Defaults** compare through `sameDefault` (`reconciliation/diffs/expression.ts`):

- keyword case outside quotes is ignored;
- a literal's cast is ignored (`'EUR'` = `'EUR'::text`);
- a number compares quoted or bare;
- a `json` / `jsonb` literal compares by value.

A default whose spelling these rules don't cover (a timestamp literal, printed in the session's time zone) re-plans as changed; it never goes unnoticed. **CHECK expressions are compared by name only**, so a changed expression under the same name isn't detected. The planned migration state (a snapshot of the last applied definition) is the intended fix for both.

### Diffs (`reconciliation/diffs/`)

Per object: `column.ts`, `indexes.ts`, `constraint.ts`, `domain.ts`, `sequence.ts`; `table.ts` orchestrates. Column attributes (`generated`) are diffed as whole-config keys; `identity` by its effective state; `defaultValue` through `sameDefault`. **Constraints compare wherever they were declared**, since the catalog doesn't record whether a one-column constraint was written on the column or on the table: CHECK and UNIQUE by name (a column's `unique` flag is the constraint PostgreSQL creates for it, `<table>_<column>_key`), the primary key by its columns. **Index keys** compare by position — a column by its name and NULLS order, an expression only by being one — and a predicate by presence: PostgreSQL prints both back deparsed, and comparing their text is deferred with CHECK expressions.

### Operations (`reconciliation/operations/`)

What ships today on existing tables (see [DSQL capabilities](./dsql-capabilities.md) for what DSQL actually allows — the column refusals are still stricter than necessary):

- Column add → bare `ADD COLUMN`, then `SET DEFAULT`, and for `NOT NULL` a backfill and a `<table>_<column>_not_null` CHECK (`NOT VALID` + validate). `NOT NULL` without a default → `NOT_NULL_NEEDS_DEFAULT`; generated → `NO_ADD_GENERATED_COLUMN`; identity → `NO_ADD_IDENTITY` (PostgreSQL makes an identity of a `NOT NULL` column only). Its CHECK and UNIQUE come from the constraint diff, and are dropped from the plan when the column is refused.
- Column modify → `SET` / `DROP DEFAULT`; `NOT NULL` → backfill (with a default) + CHECK; nullable → `DROP NOT NULL`, or `DROP CONSTRAINT` of the CHECK; identity → `SET GENERATED`, `SET` options (`START WITH`, never `RESTART`), `ADD` only on a `NOT NULL` column, `DROP IDENTITY`; generated → plain via `DROP EXPRESSION`, other generated changes → `NO_ALTER_GENERATED`; type or domain change → drop + add + the column's default, `NOT NULL`, indexes and constraints (destructive), refused on a primary-key column.
- Column drop → `DROP COLUMN` (destructive, or lossy when introspection reads the column's `dsqlbase:deprecated` comment), after the table's index and constraint steps; refused on a primary-key column. With a column added in the same plan, its note says "possible rename".
- Deprecation → `COMMENT ON COLUMN … IS 'dsqlbase:deprecated'` (or `IS NULL` to undo), also right after `CREATE TABLE` for a column created deprecated, since `CREATE TABLE` can't carry a comment; the definition serializes a deprecated `NOT NULL` column without a default as nullable, so the `DROP NOT NULL` follows from the ordinary diff.
- Renames (`operations/rename.ts`) → resolved before diffing: `renamedFrom` on a table (in `reconcile.ts`) or a column (in `diffTableOperations`) becomes `RENAME`, plus `RENAME CONSTRAINT` / `ALTER INDEX … RENAME` for the names derived from the old one; the rest is diffed against the database as it will be after them. Both names present → `RENAME_CONFLICT`.
- `diffTable` reads a `<table>_<column>_not_null` CHECK as that column's `NOT NULL` and doesn't compare it as a constraint, except for whether it was validated.
- The backfill (`BACKFILL` statement) is DML: the executor runs it batch after batch, one transaction each, retrying `40001`, until a batch matches nothing. Each batch returns `c IS NOT NULL` per row; a batch that matched rows but filled none fails the step, since the default is NULL for those rows and every later batch would pick them again. There is no cap on the number of batches — each is its own transaction; the per-transaction caps (3,000 rows, 10 MiB) bound the batch size. A literal `NULL` default counts as none at plan time (`fillsNulls`).
- Index add → `CREATE INDEX [ASYNC]`, with expression keys (`((expr))`) and a partial `WHERE`; drop → `DROP INDEX RESTRICT` (lossy), noted as removed from the definition or created outside it (no history tells them apart); any change, or `valid: false`, → rebuild by swap: `CREATE INDEX` under `<name>_rebuild`, `DROP INDEX` of the old one, `ALTER INDEX … RENAME` into place, so the old index serves and enforces until the new one is built. Names the planner builds with (`_rebuild`, a UNIQUE's `_idx`) that the database already holds are leftovers of a run that stopped part-way (`leftoverIndexesOf`): the step that builds the name again drops it first, and any other is dropped on its own; none is treated as an index the definition lacks. Derived names are kept within 63 bytes in `reconciliation/names.ts`, since the server would truncate a longer one silently and the next plan would no longer recognise it. `postgresObjectName` reproduces PostgreSQL's `makeObjectName` (the longer of table and column loses a byte at a time) for `<table>_<column>_key` — so it matches the name the database gave an inline `UNIQUE` — and for the planner's `<table>_<column>_not_null` CHECK. `deriveIdentifier` names what only the planner builds (`_rebuild`, a UNIQUE's `_idx`): past 63 bytes the base is cut and a fingerprint of the full name appended.
- CHECK add → `ADD CONSTRAINT … NOT VALID` (enforced on new writes at once), then `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` (an async job; `ASYNC` follows `asyncIndexes`). A CHECK left `NOT VALID` → `VALIDATE` alone. Drop → `DROP CONSTRAINT` (lossy).
- UNIQUE add → the promotion path: `CREATE UNIQUE INDEX ASYNC` then `ADD CONSTRAINT … UNIQUE USING INDEX`, modelled as `type: CREATE, object: <UNIQUE_CONSTRAINT>` referencing `[table, index]`, which keeps the planner acyclic. Drop → `DROP CONSTRAINT` (drops its index too; lossy). Change → its new index first, then `DROP CONSTRAINT`, then `ADD CONSTRAINT … USING INDEX`: only the last two run without the constraint.
- Primary key add, drop or change → `IMMUTABLE_CONSTRAINT`: DSQL fixes it at `CREATE TABLE`.
- Domain alters → `SET` / `DROP DEFAULT`; `DROP NOT NULL` and `DROP CONSTRAINT` of its CHECK (both destructive: DSQL can't add them back); type → `NO_ALTER_DOMAIN_TYPE`; `SET NOT NULL`, CHECK added or renamed → `NO_ALTER_DOMAIN_CONSTRAINT`.
- Sequence option changes → `ALTER SEQUENCE`.
- Names are schema-qualified outside `public`. Every statement that names a table, index, sequence or domain takes its schema from `schemaOf` (`operations/base.ts`), so no plan depends on `search_path`: an unqualified name would land in `public`, and the next plan would drop it as an object the definition lacks. `CREATE INDEX` names the index bare, as its syntax requires, and qualifies the table; the index lands in the table's schema. A domain column's `domain` is keyed `namespace.name` like the domain itself, both in the definition (`NodeRef.qualifiedName`) and in introspection, and its type prints schema-qualified. The column diff compares a domain column by that key and skips `dataType`, which the definition quotes and `format_type` doesn't.
- Drops are always `RESTRICT`; `ifExists` only adds `IF [NOT] EXISTS`. A table drop references the domains its columns use, so a domain dropped in the same plan comes after the table.
- `CREATE TABLE` carries identity columns (with `SEQUENCE NAME` when the definition names one) and generated columns inline.
- Sequence and identity options compare by their effective values: an option the definition leaves unset counts as the PostgreSQL default for a `bigint` sequence, and an identity's sequence name only counts when the definition names one. `ALTER SEQUENCE` lists only the options that changed. `ownedBy` isn't compared (deferred).
- Key-column lists (index, primary key, unique) compare in order; `include` lists compare as sets. A constraint whose kind changes under the same name is removed and added.

Refusal codes: `NOT_NULL_NEEDS_DEFAULT`, `NO_ADD_GENERATED_COLUMN`, `NO_ADD_IDENTITY`, `NO_ALTER_GENERATED`, `NO_ALTER_PRIMARY_KEY_COLUMN`, `NO_DROP_PRIMARY_KEY_COLUMN`, `RENAME_CONFLICT`, `IMMUTABLE_CONSTRAINT` (primary keys), `NO_ALTER_DOMAIN_TYPE`, `NO_ALTER_DOMAIN_CONSTRAINT`, `KIND_MISMATCH`.

### Planner (`reconciliation/planner.ts`)

Stable topological sort (Kahn's, min-id tiebreaker) over `IndexedDDLOperation[]`, inspecting only `id`, `type`, `references[]`, and the step order within a change (`summary.change` / `summary.step`: step k runs before step k + 1). For CREATE/ALTER X: edges `dep → X`; for DROP X: edges `X → dep`. Subjects key on the qualified object name, or `qualifiedConstraintName(parentTable, constraint)` for standalone constraint ops. Reference edges are never added between two operations of the same change — step order alone orders them, and a reference against it (a rebuild's `CREATE INDEX` before its `DROP`, both on the table) would close a cycle. Cycles throw — they indicate a bug in operation emission, not user input.

Deferred: sequences before the tables that own them (`OWNED BY`). `SequenceDefinition.ownedBy()` is commented out in `packages/core/src/definition/sequence.ts` and the local/introspection serializations disagree; a one-line `references[]` change lands once that is fixed.

### Reporting (`report.ts`)

`planRows(operations, errors, print)` flattens a plan into `PlanRow`s, one per operation in execution order, then one per refusal. Each row is plain data: step, change and `i/n`, subject, action, target, changes, risk (`safe` / `lossy` / `destructive` / `refused`), async, SQL, refusal. `runner.plan` returns them as `rows`, with the plan's highest `risk`; `runner.run` returns them with `status` / `durationMs` / `error`. `formatPlan` prints rows as an aligned text table or a markdown table, with no dependencies, for scripts and CI logs.

Risk is set by the operation factories, by one test: can redeploying the previous definition undo it? `safe` adds or relaxes; `lossy` removes something redeploying restores (a default, a `NOT NULL`, an index, a constraint, an identity, narrower sequence bounds); `destructive` loses data or removes what DSQL cannot re-create (dropped tables, columns, sequences, domains, schemas; type changes; `DROP EXPRESSION`).

### Validation (`validation/`)

Imperative rules `(node, ctx) => void` keyed by `node.kind`, default registry inline in `validate.ts`. Errors: `TABLE_NO_PRIMARY_KEY`, `MULTIPLE_PRIMARY_KEYS`, `DUPLICATE_COLUMN_NAME`, `DUPLICATE_OBJECT_NAME`, `DUPLICATE_SEQUENCE_NAME` (an identity's explicit sequence name already used in its namespace), `UNKNOWN_COLUMN_REFERENCE`, `EMPTY_CONSTRAINT_COLUMNS`, `IDENTIFIER_TOO_LONG` (63 UTF-8 bytes), `RESERVED_NAMESPACE`, `INVALID_SEQUENCE_CACHE`. Warnings: `REDUNDANT_UNIQUE_ON_PK`, `DUPLICATE_INDEX_COVERAGE`, `VARCHAR_WITHOUT_LENGTH`. Relations are not validated here (runtime-only; `SchemaRegistry` checks their column pairs when the client is built). Several rules restate something the high-level builders already reject at declaration time — `validate` also accepts a `SerializedSchema` that never went through them. An `UNSUPPORTED_TYPE` rule was deliberately dropped: `dataType` is pinned at compile time.

### Runner and executor (`runner.ts`, `executor.ts`)

`MigrationRunner` exposes `validate` / `introspect` / `reconcile` / `plan` / `dryRun` / `run`. `run` is a sequential orchestrator; it awaits each operation, including async jobs, before the next. `OperationExecutor` prints per-op SQL, dispatches sync/async, waits with `CALL sys.wait_for_job(id)` (a procedure returning `{ succeeded }`), and reads `sys.jobs` by its snake_case columns for the job's type and failure details. `updatePendingJobsStatus` refreshes every still-pending job with one `sys.jobs` read, for a driver that submits independent async steps without waiting on each and waits only before a dependent one (`ADD CONSTRAINT … USING INDEX`); `run` itself waits step by step. **Async is detected by response shape** (a `{ job_id }` row), not by statement kind, so `DROP INDEX` and future async DDL need no special casing. `MigrationRunnerOptions` is `Partial<DDLOperationOptions>` plus `allow`, so `asyncIndexes` / `ifExists` flow into operation factories — the seam that lets PGlite and DSQL share one runner.

Gates: invalid definitions throw from `plan` / `dryRun` / `run`. Refusals, and steps whose risk isn't in `allow` (`lossy` allowed by default, `destructive` not), throw from `dryRun` / `run`, listing every offending step; `plan` marks them `blocked`. `run` stops at the first failed step, reports the rest `skipped`, and throws `MigrationError` (`STEP_FAILED`) carrying the `RunResult` as `result` and the step's thrown error, if any, as `cause`. A failed `wait_for_job` call fails its step the same way rather than escaping `run` and losing the rows already executed.

## Out of scope today (tracked, not forgotten)

Rename detection (a rename is add + refused drop), FK emission, view/function migration (AST kinds reserved), triggers, grants, online type changes via shadow column + backfill. The migrations proposal revisits these against the current DSQL grammar.

## Related

- [DSQL capabilities](./dsql-capabilities.md)
- [Architecture](./architecture.md)
- [Migrations (guide)](../guide/migrations.md)
- [Decision 0002 — migration consolidation](../decisions/0002-migration-consolidation.md)
- [Decision 0014 — DSQL catch-up, changes and steps, risk gates](../decisions/0014-migration-dsql-catchup.md)
