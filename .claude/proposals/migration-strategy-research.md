# Migration Strategy — Research & Recommendation

Research synthesis from 2026-04-22, informing the migrations-module-mvp proposal and
the companion `semantic-constraints.md`.

Investigates how distributed databases and schema-management tools handle
non-destructive schema evolution, and lands on the strategy dsqlbase will adopt:
**the DB owns table and column shape; the ORM owns semantics**.

## What the industry does

**Two-version invariant.** CockroachDB (inspired by Google's F1 paper) guarantees that
at any moment, only two *adjacent* schema versions are live across the cluster, and
those two versions must be mutually compatible. Schema changes move through
intermediate states (`DELETE_ONLY` → `WRITE_ONLY` → `PUBLIC`) precisely so a node on
version *N* and a node on version *N+1* never corrupt each other. All distributed
databases converge on some form of this invariant.

**Expand/Contract (Parallel Change)** is the application-level expression of the
same invariant. Every breaking change is decomposed into:

1. **Expand** — add the new shape alongside the old, backward-compatible.
2. **Migrate** — dual-write / backfill, deploy app code using the new shape.
3. **Contract** — remove the old shape.

Every serious schema-management tool in 2025-2026 — Prisma, Atlas, Liquibase, pgroll,
Flyway — treats this as the default mental model. They differ mainly in how much of
the three phases the tool automates.

**Tool-level automation.** pgroll (Xata) goes furthest: per-version views plus
dual-write triggers let old and new app versions connect through version-scoped views
during rollout. Requires views + triggers — primitives DSQL doesn't expose, so not
available to us.

**Safety policy in migration tools.** The convergent standard is **lint +
fail-on-destructive-by-default**. Atlas ships 50+ rules classifying operations by
risk; dropping a column or adding `NOT NULL` without a default fails the CI check
unless explicitly approved. Prisma recommends the same. Liquibase supports
preconditions but no lint engine.

## How DSQL fits

DSQL enforces the two-version invariant **by restriction**, not by automation.
It forbids any `ALTER COLUMN` constraint/type change and `DROP COLUMN` outright.
The only DDL you can issue against an existing table is forward-compatible by
construction — old app versions cannot observe a schema state that would break them,
because the DB won't let the operation happen in the first place.

Confirmed probe (2026-04-22) of DSQL `ALTER TABLE`:

| Action                                                              | Allowed? |
| ------------------------------------------------------------------- | -------- |
| `ADD COLUMN` with no constraints (bare nullable)                    | ✅        |
| `ADD COLUMN` with `NOT NULL` / `DEFAULT` / `UNIQUE` / `PK`          | ❌        |
| `DROP COLUMN`                                                       | ❌        |
| `ALTER COLUMN SET/DROP NOT NULL` / `SET DEFAULT` / `SET DATA TYPE`  | ❌        |
| `ALTER COLUMN` identity operations (`SET GENERATED`, `RESTART`, …)  | ✅        |
| `RENAME` / `RENAME COLUMN` / `RENAME CONSTRAINT`                    | ✅        |
| `SET SCHEMA`                                                        | ✅        |
| `ADD CONSTRAINT ... UNIQUE USING INDEX` (two-step with a built index) | ✅      |

The last row matters: DSQL supports promoting an existing unique index into a
uniqueness constraint. This is the one evolvable *constraint* path on the DB side.

## The thesis: semantics move to the ORM

The earlier framing of this document proposed teaching users the two-version invariant
through error messages and a strict migration gate. That approach preserves DB-level
constraints at the cost of a complex UX: users hit surprise errors, schema definitions
read differently over their lifetime (initial creation vs. evolution), and features
like auto-inferred relation cardinality break when `.notNull()` has to be dropped.

dsqlbase targets quick projects, startups, and solo teams — users who want an easy
pick-up interface for DSQL without having to reason about distributed-systems
trade-offs. DSQL's own design already pushes in this direction: no foreign keys,
relations are an app-level concept.

**The proposal extends that axis one more notch.** Except for primary keys and
uniqueness, all column-level semantics — `notNull`, `default`, `check`, relation
cardinality — move to the ORM. The schema definition remains a single source of
truth for the *contract*, and the ORM enforces that contract at read and write time.
The DB's role shrinks to what it can guarantee cheaply and evolvably:

| Layer           | Responsibility                                                       |
| --------------- | -------------------------------------------------------------------- |
| **DB (DSQL)**   | Table existence, primary key, column existence/type, indexes, uniqueness |
| **ORM / app**   | Nullability (semantic), defaults, checks, relation cardinality, read-side graceful degradation |

Inspired by GraphQL's [Semantic Nullability
RFC](https://github.com/graphql/graphql-wg/blob/main/rfcs/SemanticNullability.md#-6-semanticnonnull-directive):
`nonNull` becomes a contract the client enforces, not a storage-layer constraint.

### Why this works for dsqlbase specifically

1. **Consistent API.** `.notNull()` means the same thing on day 1 and day 300.
   New tables and new columns accept the same declarations. No split surface.
2. **Consistent migrations.** The diff reconciles *shape*, not semantics — always
   additive, always DSQL-compatible. Migrations rarely fail because of constraint
   mismatches.
3. **Relation inference survives.** Cardinality is derived from the schema, not
   probed from the DB, so `post.author: User` stays non-null even when the DB
   column is nullable.
4. **Graceful degradation.** When historical data violates a fresh contract (a
   column became `.notNull()` after rows already existed without values), the ORM
   drops the offending object up to the nearest nullable parent or root.
5. **Fits DSQL's philosophy.** DSQL already rejects relational integrity at the DB
   layer (no FKs). Pushing the rest of the semantic layer up is the same move.

### What we give up

- **Raw-SQL bypass.** A user running `psql` can `INSERT` a `NULL` into a column the
  schema declares `notNull`. This is a real hole but mirrors every ORM with
  app-level defaults, soft deletes, polymorphic columns, etc.
- **DB-as-sole-source-of-truth.** The schema and DB are now two cooperating
  enforcers. A drift inspector (`dsqlbase inspect`) shows where they disagree.
- **Uniqueness is the one exception.** App-level uniqueness has a TOCTOU race under
  concurrent inserts. `.unique()` materializes as a DB-level unique index
  (optionally promoted to a constraint via `UNIQUE USING INDEX`) so the guarantee
  stays race-free. See `semantic-constraints.md` for details.

## Consequences for the migration layer

The migrator's charter simplifies to: **make sure the DB can serve what the
schema describes.** Concretely:

- **New table in the schema, missing in the DB** → `CREATE TABLE` (inline PK + unique).
- **New column in the schema, missing in the DB** → `ADD COLUMN name type` (bare; no
  constraints, because ADD COLUMN in DSQL can't carry them — and now it doesn't
  need to, since the constraint lives at the ORM).
- **New `.unique()` on an existing column** → `CREATE UNIQUE INDEX ASYNC` + wait,
  then `ALTER TABLE ADD CONSTRAINT ... UNIQUE USING INDEX` to promote it.
- **New index declared** → `CREATE INDEX ASYNC` + wait.
- **Table/column exists in the DB but not in the schema** → leave it alone by
  default (graceful degradation / archived). Optional opt-in to drop.
- **Column type mismatch** → warn via `dsqlbase inspect`; the migrator never
  attempts `ALTER COLUMN SET DATA TYPE` because DSQL rejects it.

No A/B/C/D classifier. No strict-mode gate. No "constraints are creation-time
commitments" teaching moment. The migrator is a reconciler, and it almost always
succeeds.

## Sources

- [pgroll's expand-contract automation with per-version views](https://xata.io/blog/pgroll-expand-contract)
- [CockroachDB online schema change RFC — state transition invariant](https://github.com/cockroachdb/cockroach/blob/master/docs/RFCS/20151014_online_schema_change.md)
- [How online schema changes work in CockroachDB (F1 paper lineage)](https://www.cockroachlabs.com/blog/how-online-schema-changes-are-possible-in-cockroachdb/)
- [Atlas — strategies for reliable migrations](https://atlasgo.io/blog/2024/10/09/strategies-for-reliable-migrations)
- [Atlas DSQL guide](https://atlasgo.io/guides/dsql/automatic-migrations)
- [Prisma Data Guide — expand and contract pattern](https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern)
- [Expand/Contract — Pete Hodgson](https://blog.thepete.net/blog/2023/12/05/expand/contract-making-a-breaking-change-without-a-big-bang/)
- [AWS — Aurora DSQL agentic migration](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/dsql-agentic-migration.html)
- [DSQL ALTER TABLE syntax — `UNIQUE USING INDEX`](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html)
- [GraphQL Semantic Nullability RFC](https://github.com/graphql/graphql-wg/blob/main/rfcs/SemanticNullability.md#-6-semanticnonnull-directive)
