---
epic: schema-prerequisites
status: in-progress
owner: silviu
created: 2026-09-21
---

# Schema prerequisites — shared runtime work

Implements `.claude/proposals/schema-prerequisites.md`. Every story here is needed by at
least two of the schema features (`schema-guid.md`, `schema-polymorphic-relations.md`,
`schema-embeddable-objects.md`) or the client features (`client-pagination.md`,
`client-runtime-joins.md`, `client-tenancy.md`), or is a correctness fix they all rely on.
None introduces a feature.

## Working agreement

One branch (`feat/schema-prerequisites`), one PR, **one commit per story**, review between
stories. Each story carries its own changeset with a `Docs:` line and updates its docs pages
in the same commit. Stories 3 and 5 get a design note in this file, approved before coding.

## Stories

| # | Story | Level | Status |
|---|---|---|---|
| 0 | Run the type-level suite for real; build deps before test | `patch` | ✅ |
| 1 | `Table.primaryKey` / `isCompositeKey`; one-PK rule; PK `include()` fix | `minor` | ✅ |
| 2 | `Table.alias`, `getAlias`, `getTableEntries`, shared `attachModels` | `patch` | ✅ |
| 3 | Table aliasing in select trees (`SQLScope`, builder-owned) | `minor` | ✅ |
| 4 | Relation pair validation in `SchemaRegistry` (correlation done in story 3) | `minor` | ✅ |
| 5 | `$$meta`, `table().meta()`, row-aware resolver tree | `minor` | ⬜ design note first |
| 6 | `OnSelectionOf` + `resolveOnSelection` | `patch` | ⬜ |
| 7 | Codec-aware where clauses (`Column.param`) | `minor` | ⬜ |
| 8 | Duplicate DB column names; `getColumn` by path | `minor` | ⬜ |
| 9 | One field namespace per table | `minor` | ⬜ |

## Deviations from the proposal

- **Story 0 is new.** The proposal assumes type-level tests run. They did not: `packages/dsqlbase`
  documented `vitest run --typecheck` but no config enabled `typecheck`, and the build
  `tsconfig.json` excludes `*.test.ts`, so every `expectTypeOf` was a no-op. Stories 5 and 6 are
  largely type work, so this had to be real first. The turbo `test` task also gained
  `dependsOn: ["^build"]`.
- **Story 1 grew a one-primary-key rule and moved from `patch` to `minor`.** The proposal only
  asked for `Table.primaryKey`, but the key is only well-defined if exactly one is declared, and
  the DDL printer emits each source independently (inline `PRIMARY KEY` per flagged column plus a
  `PRIMARY KEY (...)` clause per constraint), so multiple declarations shipped DDL Postgres
  rejects with no error anywhere. Fixed on both paths: the runtime `Table` throws, and a new
  `MULTIPLE_PRIMARY_KEYS` validation rule covers schemas that only run migrations.
- **One PR instead of one PR per story**, so each story stays independently reviewable as a commit
  without nine merge cycles.

## Story 3 — as built

Shipped differently from both the proposal and the pre-implementation note below. Aliasing is
owned entirely by `QueryBuilder`; the normalizer is untouched and `OperationsFactory` got
smaller. Recorded in `docs/decisions/0003-select-tree-aliasing.md`, with the full design and
the correlation walkthrough in `docs/internals/select-tree-aliasing.md`. Accepted with four
open concerns listed in that record. The composite-pair half of story 4 came forward with it;
story 4 is now the registry-side validation only.

The record numbering shifts as a result: the epic-wide prerequisites record is no longer
`0003`, and the guid / polymorphic-relations records move down accordingly.

## Story 3 design note (pre-implementation, superseded) — table aliasing in select trees

_Status: awaiting approval. No code written yet._

### What is actually broken

Generated today, for `tasks.parent -> tasks` (a self-relation):

```sql
SELECT "tasks"."id", "__join_parent"."data" AS "parent" FROM "tasks"
LEFT JOIN LATERAL (
  SELECT row_to_json("__t".*) AS "data" FROM (
    SELECT "tasks"."id" FROM "tasks" WHERE "tasks"."parent_id" = "tasks"."id" LIMIT $1
  ) AS "__t"
) AS "__join_parent" ON true
```

Both sides of the correlation bind to the **inner** `FROM "tasks"`, so the predicate reads
`parent_id = id` on a single row. Postgres accepts it; the result is silently wrong.

The broken case is precisely: **a join whose target is the same physical table as an
ancestor level.** `runtime-pipeline.md` also claims "the same table twice at one level"
collides — it does not. Sibling laterals each have their own scope:

```sql
FROM "tasks"
LEFT JOIN LATERAL (SELECT ... FROM "users" WHERE "tasks"."assignee_id" = "users"."id") AS "__join_assignee" ON true
LEFT JOIN LATERAL (SELECT ... FROM "users" WHERE "tasks"."reviewer_id" = "users"."id") AS "__join_reviewer" ON true
```

That is correct SQL. The docs line gets fixed as part of this story.

### Mechanism (differs from the proposal)

The proposal specifies "a scope stack on `SQLContext`". `SQLContext` is constructed inside
`SQLQuery.toQuery()` at render time and nodes render depth-first with no enter/exit signal,
so a stack needs push/pop marker nodes wrapping every level — machinery that buys nothing.

Proposed instead — **the alias is decided when args are built, not when SQL is rendered**:

- `Scope` is an opaque token carrying an ordinal: `{ index }`, with `tableAlias = "__t<index>"`
  and `jsonAlias = "__j<index>"`. Allocated once per level by a per-request allocator.
- `SelectOperationArgs.scope?: Scope` and `SelectParams.scope?: Scope`. The normalizer
  allocates while walking `_getSelectArgs`; `OperationsFactory._resolveSelectParams` allocates
  a fallback when `args.scope` is absent, so direct `OperationsFactory` use (as the core tests
  do) keeps working.
- New `ColumnRef(column, scope?)` SQL node renders `"<scope.tableAlias>"."<column.name>"`, and
  falls back to `"<table>"."<column>"` when it has no scope.
- `QueryBuilder` emits `FROM ${table} AS "<scope.tableAlias>"` and uses `scope.jsonAlias` for
  the `row_to_json` wrapper in place of the fixed `"__t"`. It only ever *reads* the scope, so
  it stays stateless and needs no counter.

`Column.toSQL` is unchanged, so `$query` users writing `${users.columns.id}` are unaffected.

### Every place a column reference is produced

| Site | Owner | Scope |
|---|---|---|
| `select` columns | `_resolveFields` (core) | own level |
| `where` | `_getWhereExpression` (normalizer) | own level |
| `orderBy` | `_getOrderByEntries` (normalizer) | own level |
| join correlation `sql.eq(from, to)` | `_resolveJoinEntries` (core) | **spans two** — `from` is the parent's scope, `to` the child's |

The correlation is why the scope must be explicit rather than looked up by table: in a
self-join both sides hold the same `Table` object.

### DML

`UPDATE` / `DELETE` / `INSERT ... RETURNING` have no select tree and no ambiguity. They keep
producing scope-less refs, which render as they do today via the fallback. `_getWhereExpression`
takes an optional scope: present for select, absent for DML.

### Naming

`packages/core/src/definition/constraint.ts` already has an unexported
`type ColumnRef = NodeRef<AnyColumnDefinition>`, and `definition/table.ts` exports
`ColumnRefs<TColumns>`. Both are unrelated. The new node needs a distinct name or that local
alias renamed.

### Open choices for approval

1. **Aliasing scope.** Unconditional (every select, including flat ones:
   `SELECT "__t0"."id" FROM "users" AS "__t0"`), or only when the tree contains at least one
   join (flat selects unchanged). Both are one-pass. Aliasing only the levels that actually
   collide is rejected: whether a parent needs an alias depends on its descendants, so it
   needs a second analysis pass.
2. **Alias spelling.** Opaque `__t0` / `__t1` as the proposal says, or readable
   `__users_0` / `__tasks_1` derived from the schema alias.

### Cost

SQL text changes for affected selects, so `query.test.ts` snapshots and any e2e assertion on
SQL text are rewritten. The e2e fixture gains `tasks.parentId` plus a `tasks.parent`
self-relation; `introspection.spec.ts` asserts with `arrayContaining` and the seed uses
explicit column lists, so a new nullable column does not disturb them.

## Open questions

- **Story 3** — the proposal specifies a scope stack on `SQLContext`, but `SQLContext` is built
  inside `SQLQuery.toQuery()` at render time and nodes render depth-first, so a stack needs
  push/pop marker nodes. A mutable `Scope` token stamped with its alias at build time is the
  candidate alternative. Decide when the story starts.
- **Story 5** — `schema-guid.md` wants `$$meta` implemented only after
  `schema-polymorphic-relations.md` is accepted, so the union select interface is settled;
  `schema-prerequisites.md` orders it unconditionally. Confirm before starting.

## Close-out

`docs/decisions/0003-schema-prerequisites.md` on completion; delete
`.claude/proposals/schema-prerequisites.md`; renumber the guid record to `0004` and the
polymorphic-relations record to `0005`.
