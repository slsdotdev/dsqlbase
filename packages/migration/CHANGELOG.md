# @dsqlbase/migration

## 0.2.0

### Minor Changes

- 2e0b361: Types and the model surface:
  - **Relations split across several `relations()` blocks are typed;** a table with two blocks had no relation names at the type level, though its queries ran.
  - **One model per table, under its schema alias.** A table exported as `members` but named `team_members` also appeared as `dsql.team_members` when the client was indexed dynamically; that duplicate is gone. `Table.alias` holds the alias.
  - **Exported object types are `type` aliases,** so they can no longer be extended by declaration merging (`declare module "dsqlbase" { interface QueryArgs … }`).

  **Breaking:** the two behaviour changes above.

  Docs: docs/guide/relations.md, docs/internals/runtime-pipeline.md

- 2e0b361: Columns change on existing tables, within what DSQL allows (verified on a live cluster). DSQL's `ADD COLUMN` takes no attributes and DSQL has no `SET NOT NULL` or `SET DATA TYPE`, so each change is built from what it does allow:
  - **Adding a column:** `ADD COLUMN`, then `SET DEFAULT`; existing rows stay `NULL`.
  - **`NOT NULL`, on a new or an existing column:** a **backfill** of existing rows with the default (1,000 rows per transaction, retried on `40001`), then a `CHECK (c IS NOT NULL)` added `NOT VALID` and validated. The CHECK reads back as the column's `NOT NULL`. A backfill whose default turns out `NULL` stops and fails the step instead of looping. Adding a `NOT NULL` column without a default — a literal `NULL` included — is refused (`NOT_NULL_NEEDS_DEFAULT`).
  - **Defaults:** `SET` / `DROP DEFAULT`; `DROP NOT NULL`, or `DROP CONSTRAINT` of the CHECK.
  - **Dropping a column** is destructive, and runs after the table's index and constraint steps. With a column added in the same plan, its note flags a possible rename.
  - **Changing a type** is drop + add + the column's default, `NOT NULL`, indexes and constraints (destructive); refused on a primary-key column.
  - **Generated and identity columns:** a generated column can be made plain (`DROP EXPRESSION`); identity options change in place, never with `RESTART`.

  **Breaking:** the refusal codes `IMMUTABLE_COLUMN` and `NO_DROP_COLUMN` are replaced by `NOT_NULL_NEEDS_DEFAULT`, `NO_ADD_GENERATED_COLUMN`, `NO_ADD_IDENTITY`, `NO_ALTER_GENERATED`, `NO_ALTER_PRIMARY_KEY_COLUMN` and `NO_DROP_PRIMARY_KEY_COLUMN`. A changed identity start value no longer restarts its sequence.

  Docs: docs/guide/migrations.md, docs/internals/migration-pipeline.md

- 2e0b361: Constraints and indexes change on existing tables, within what DSQL allows (verified on a live cluster).
  - **CHECK:** `ADD CONSTRAINT … NOT VALID`, enforced on new writes at once, then validated against existing rows by an async job. If a row violates it, the run stops and the constraint stays, not valid; once the data is fixed, the next plan is just the `VALIDATE`.
  - **Changed indexes are rebuilt without a gap:** the new index is built beside the old one as `<name>_rebuild`, the old one dropped, and the new one renamed into place, so the old index serves reads and enforces uniqueness until then. A changed UNIQUE builds its new index before its old constraint is dropped. An index whose async build failed is repaired the same way, and a run that stops part-way starts over cleanly.
  - **Expression and partial indexes:** ``.columns((c) => [sql`lower(${c.email})`])`` and ``.where((c) => sql`…`)``. Expressions and predicates compare by position and presence, since PostgreSQL prints them back reformatted: to change one, rename the index.
  - **Removed CHECKs, UNIQUEs and indexes are dropped as lossy steps.** An index the definition doesn't declare is dropped too, and the plan notes that it may have been created by hand.
  - **Constraints compare wherever they were declared** (on the column or on the table), and introspection reads back whether a CHECK is validated and an index valid.

  **Breaking:** `IMMUTABLE_INDEX` is gone, and `IMMUTABLE_CONSTRAINT` now covers primary keys only. `IndexColumnDefinition.sort()` is removed: DSQL refuses `ASC` / `DESC` on index keys. `nullsFirst()` / `nullsLast()` remain.

  Docs: docs/guide/schema.md, docs/guide/migrations.md, docs/internals/migration-pipeline.md

- 826ff2d: Domains change as far as DSQL allows: `SET` / `DROP DEFAULT`, and `DROP NOT NULL` and `DROP CONSTRAINT` of the domain's CHECK — both destructive, since DSQL can't add either back. Making a domain `NOT NULL`, adding or renaming its CHECK (`NO_ALTER_DOMAIN_CONSTRAINT`), and changing its type (`NO_ALTER_DOMAIN_TYPE`) are refused: define a new domain and move the columns to it.

  **Breaking:** `IMMUTABLE_DOMAIN` is replaced by `NO_ALTER_DOMAIN_TYPE` and `NO_ALTER_DOMAIN_CONSTRAINT`.

  Docs: docs/guide/migrations.md

- 2e0b361: Migration fixes, most found against a live DSQL cluster:
  - **An unchanged schema plans nothing on a second run.** Defaults compare by meaning rather than spelling; sequence and identity options by their effective values; composite primary keys and DSQL's implicit primary-key `INCLUDE` no longer re-plan; a `NULLS FIRST` index key is read back correctly.
  - **Objects in a `namespace()` are created, altered and dropped in their own schema.** Statements named them unqualified, so a table landed in `public` and the next plan dropped it. A column typed by a domain in a namespace uses its schema-qualified type.
  - **Derived constraint names stay within PostgreSQL's 63 bytes,** shortened as PostgreSQL shortens its own, so a long `<table>_<column>_not_null` is found again instead of failing every later deploy.
  - **Async DDL no longer hangs on DSQL;** jobs are read and waited for correctly.
  - **`CREATE TABLE` carries identity and generated columns,** which it dropped.
  - **Key-column order is compared** for indexes and keys, and a constraint whose kind changes is replaced.
  - **A change that recreates a column's index and CHECK** no longer stops the planner with a dependency cycle.

  **Breaking:** a column typed by a namespaced domain serializes its `domain` as `namespace.name` and its type schema-qualified.

  Docs: docs/guide/migrations.md, docs/internals/migration-pipeline.md, docs/internals/dsql-capabilities.md

- 2e0b361: Rename and retire columns and tables without losing data.
  - **`.renamedFrom("previous")`** on a column or a table makes the migration emit `RENAME` instead of a drop and an add. Constraints and indexes named after the old name are renamed with it. When both names exist, the rename is refused (`RENAME_CONFLICT`); once the database has the new name, the hint does nothing.
  - **`.deprecated()`** on a column hides it from the client — results, filters, ordering and inputs, in the types and at runtime — and marks it in the database with the comment `dsqlbase:deprecated`, dropping its `NOT NULL` when it has no default. A table created with a column already deprecated gets the marker in the same run.
  - **In a later release,** removing the column from the definition drops it as a **lossy** step, so it runs without `allow.destructive`.

  A primary-key column or an embedded-object member can't be deprecated.

  Docs: docs/guide/schema.md, docs/guide/migrations.md

- 2e0b361: Plans report what they change, one row per step.

  A change — one difference on one column, index or constraint — runs as one or more steps, each a single statement in its own transaction, so a failure points at exactly one step. `runner.plan()` returns `rows` and the plan's highest `risk`; `runner.run()` returns `rows` with each step's `status`, `durationMs` and `error`. `formatPlan(planOrRows, { format, sql })` prints them as a text or markdown table: subject, action, target, attribute changes (`from` → `to`), risk, async, and a note where a step needs one.

  **Breaking:** `DDLOperation` requires a `summary`; column changes are no longer batched into one `ALTER TABLE`.

  Docs: docs/guide/migrations.md

- 2e0b361: What a migration may do is set by risk, and a failed step fails the run.
  - **`allow: { lossy?, destructive? }`** replaces `destructive`. `safe` steps always run. `lossy` steps run by default: they remove what redeploying restores (an index, a default, a constraint, an identity), or drop a column deprecated in an earlier release. `destructive` steps — dropping a table, a column, a sequence, a domain or a schema — need `allow.destructive: true`.
  - **`run` and `dryRun` list every step `allow` doesn't cover** in the `MigrationError` they throw (`DESTRUCTIVE_NOT_ALLOWED`, `LOSSY_NOT_ALLOWED`), with each step's note; `plan(definition, { allow })` marks them `blocked`.
  - **`run` throws when a step fails.** It stops at that step and throws a `MigrationError` with a `STEP_FAILED` issue naming it; `error.result` is the full `RunResult`, the steps after it `skipped`. A re-run plans from the database as it now is, and resumes there.
  - **`MigrationError` is exported,** with `MigrationIssue`.
  - **`ifExists`** replaces `safeOperations`. It only adds `IF [NOT] EXISTS`, and defaults to `true`. Drops are always `RESTRICT`.

  **Breaking:** `destructive`, `safeOperations` and `PlanResult.destructive` are replaced as above; dropping an index now runs by default, as a lossy step; and `run` throws on a failed step where it used to resolve with it in its rows. To print the report on failure, pass `error.result` to `formatPlan`.

  Docs: docs/guide/migrations.md, docs/internals/migration-pipeline.md

- 2e0b361: A schema that would build wrong queries or DDL now fails when it is declared or when the client is created, naming the problem:
  - More than one primary key on a table (`MULTIPLE_PRIMARY_KEYS` in migration validation). A composite key is one constraint over several columns.
  - Two fields mapped to one database column (`DUPLICATE_COLUMN_NAME`).
  - A relation named like a column of its table: columns and relations share one field namespace.
  - A relation whose column pairs differ in number or type, or name a column of the wrong table.
  - An identity's explicit sequence name already used in its namespace (`DUPLICATE_SEQUENCE_NAME`).

  `Table.primaryKey` and `Table.isCompositeKey` expose the key at runtime, wherever it was declared.

  **Fixed:** `PrimaryKeyConstraintDefinition.include()` replaced the key columns with the included ones.

  **Breaking:** each schema above used to build and failed later, or silently misbehaved.

  Docs: docs/guide/schema.md, docs/guide/relations.md, docs/internals/migration-pipeline.md

### Patch Changes

- 2e0b361: Documentation now lives in [`docs/`](https://github.com/slsdotdev/dsqlbase/tree/main/docs): a guide for using the packages, the internals for contributing, and a record of each design decision. The package READMEs point there, and `QueryArgs.limit` no longer claims a default limit that was never applied.

  Docs: docs/README.md, docs/guide/README.md, docs/internals/README.md, docs/decisions/README.md

- 2e0b361: Packaging fixes for every published package:
  - **The MIT `LICENSE` is now in each tarball.** It was listed as `../../LICENSE`, a path npm ignores, so no release shipped it.
  - **`engines.node` is declared, `>=22`**, and CI runs every suite on Node 22 as well as 24.
  - **In `exports`, `types` comes before `default`**, as TypeScript expects. It resolved before only because the `.d.ts` files sit next to the `.js` files. `publint` and `attw` now check every package in CI.
  - **`homepage` points to the repository.**
  - **Sourcemaps include their sources**, so stack traces and debuggers show the original TypeScript. This makes the packages larger.
  - **The build starts from an empty `dist/`**, so a deleted module can't linger in a tarball.

  Docs: docs/guide/install.md (Requirements), docs/internals/conventions.md (Packaging), docs/internals/architecture.md.

- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [0927824]
- Updated dependencies [6b80bf1]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
- Updated dependencies [2e0b361]
  - @dsqlbase/core@0.2.0

## 0.1.6

### Patch Changes

- @dsqlbase/core@0.1.6

## 0.1.5

### Patch Changes

- @dsqlbase/core@0.1.5

## 0.1.4

### Patch Changes

- @dsqlbase/core@0.1.4

## 0.1.3

### Patch Changes

- @dsqlbase/core@0.1.3

## 0.1.2

### Patch Changes

- 96b7e7d: package cleanup
- Updated dependencies [96b7e7d]
  - @dsqlbase/core@0.1.2

## 0.1.1

### Patch Changes

- @dsqlbase/core@0.1.1
