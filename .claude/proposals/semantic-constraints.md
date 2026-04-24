# Semantic Constraints — Design Proposal

Companion to `migrations-module-mvp.md` and `migration-strategy-research.md`.
Describes how column-level semantics that used to live at the DB — nullability,
defaults, checks, relation cardinality — are enforced by the ORM layer instead.

## Why

The migration-strategy research doc lays out the reasoning: DSQL's `ALTER TABLE`
restrictions make constraint evolution impractical, and forcing users to drop
`.notNull()` just to add a column later breaks relation inference and creates a
surprise-error UX. The cleaner answer is to treat **the schema definition as the
contract**, with the DB enforcing what it cheaply can (shape + uniqueness) and the
ORM enforcing the rest at write and read time.

Inspired by GraphQL's [Semantic Nullability
RFC](https://github.com/graphql/graphql-wg/blob/main/rfcs/SemanticNullability.md):
`notNull` is a semantic promise the client enforces, not a storage-layer
constraint.

## Layer split

| Concern                             | Enforced by | Mechanism                                                |
| ----------------------------------- | ----------- | -------------------------------------------------------- |
| Table / column existence            | DB          | `CREATE TABLE` / `ADD COLUMN`                            |
| Column data type                    | DB          | `CREATE TABLE` / `ADD COLUMN`                            |
| Primary key                         | DB          | `CREATE TABLE` inline                                    |
| Index existence                     | DB          | `CREATE INDEX ASYNC`                                     |
| **Uniqueness**                      | **DB**      | **Unique index + `ADD CONSTRAINT … UNIQUE USING INDEX`** |
| Nullability (`notNull`)             | ORM         | Write-time validation + read-time cascade-null           |
| Defaults (`$onCreate`, `$onUpdate`) | ORM         | Runtime hooks already present                            |
| Check / validation rules            | ORM         | Runtime validators on the column resolver                |
| Relation cardinality                | ORM         | Derived from schema-level `notNull` on the foreign key   |

Uniqueness is the one semantic exception — see below for why.

## `notNull` as a semantic promise

The user writes:

```ts
table("posts", {
  id: uuid().primaryKey(),
  title: varchar().notNull(),
  author_id: uuid().notNull(), // drives relation cardinality
});
```

What this means at each layer:

- **Types.** `Post.title` is inferred as `string`, not `string | null`. Relations
  derived from `author_id` are inferred as required (`post.author: User`, not
  `User | null`).
- **DB.** The column is physically nullable. DSQL either allows `NOT NULL` at
  `CREATE TABLE` but refuses at `ADD COLUMN`, which forces the asymmetric UX we
  want to avoid. So the migrator **never emits `NOT NULL`**, even for new tables —
  keeping the column shape identical whether a column is declared on day 1 or
  day 300.
- **Write path.** The ORM's insert / update pipeline validates the payload against
  the schema before building the SQL. Missing or null values for `notNull` columns
  become a structured validation error before anything reaches the DB.
- **Read path.** The ORM's result-materialization step checks each row against
  the schema and applies the cascade-null-upward policy below.

## Read-side policy: cascade-null-upward

When a row arrives from the DB with a `NULL` in a column declared `notNull`, the
ORM **does not** surface that row as-is. The policy:

> If a required field is `null`, the parent object becomes `null`. If the root
> object is `null`, the row is omitted from the result set.

Intuition: we maintain the schema's type contract by dropping data that violates
it, rather than lying about types or throwing at the caller.

### Worked example

Query: `posts.find({ include: { author: true } })`.

Schema:

```ts
posts.title      notNull
posts.author_id  notNull   → post.author is required
users.name       notNull
users.bio        nullable
```

Three rows returned by the DB:

| row | title  | author_id | author.name | author.bio |
| --- | ------ | --------- | ----------- | ---------- |
| 1   | "Hi"   | u1        | "Ana"       | `null`     |
| 2   | "Hey"  | u2        | `null`      | "Hello"    |
| 3   | `null` | u3        | "Carl"      | `null`     |

Result after policy application:

- Row 1 → kept. `author.bio` is nullable, `null` is legal.
- Row 2 → `author.name` is `null` but required on `users` → `author` becomes
  `null`. But `post.author` is required on `posts` → the whole post is dropped.
- Row 3 → `title` is required on `posts` and root is `posts` → row dropped.

Final result: one row.

### Why this policy

1. **Types stay honest.** The caller's inferred type (`Post.title: string`) is
   never violated at runtime — we only return rows that actually satisfy the
   contract.
2. **Graceful degradation.** Historical data that pre-dates a `notNull` promise
   disappears from queries instead of crashing them. The user isn't forced into a
   "clean up old rows first" migration ceremony.
3. **Composes with relations.** Required-relation inference works end-to-end:
   `post.author: User` holds because any row where that would be false is dropped.
4. **Symmetric with structure.** A missing branch in a JSON object already
   collapses that subtree — this is the same rule applied to relational data.

### Counts and pagination — flagged, not solved

`SELECT COUNT(*)` happens at the DB, filtering happens in the ORM. A user asking
"page 3 of 20" may see 18 rows instead of 20 if two got filtered by the policy.

Three acceptable stances, to decide when we get there:

1. **Document the mismatch** (MVP). "Result counts are contract-filtered; raw DB
   counts may differ." Fastest, most honest.
2. **Expose filtered count in the result envelope.** `{ rows, total, filtered }`
   so callers can reconcile.
3. **Provide `count()` that applies the same filter.** Correct but expensive —
   requires materializing rows to evaluate.

Not an MVP decision. Flag in docs so it's not a surprise.

### Per-query escape hatch (future)

If a user legitimately wants to see the dirty rows — for a dashboard, data
cleanup tool, or debugging — we can add an opt-in:

```ts
posts.find({ where: { … }, includeContractViolations: true });
// → rows carry a __violations field listing which fields violate the schema
```

Deferred; mention in the doc so it's not re-litigated.

## Defaults, `$onCreate`, `$onUpdate`

Already present in the runtime as lifecycle hooks. The shift: they become the
**only** source of defaults. DB columns carry no `DEFAULT` clause.

- `$onCreate: () => crypto.randomUUID()` — runs on insert if the user didn't
  provide a value.
- `$onUpdate: () => new Date()` — runs on every update.
- Static default: `$default: 0` — sugar over a zero-arg `$onCreate`.

Because these are JS values, they can be anything the runtime can produce
(including async in future) — not just what Postgres `DEFAULT` expressions
support. That's strictly more powerful than the DB-level alternative.

## Check / validation rules

Declarative validators attached to the column definition, run at write time
before the SQL is built:

```ts
email: varchar().check((v) => v.includes("@") || "must contain @"),
rating: int().check((n) => n >= 0 && n <= 5 || "out of range"),
```

Failures raise structured validation errors from the ORM with a predictable
shape (`{ column, value, message }`).

Read-side checks aren't automatic — if a user wants to re-verify checks on reads
(for suspected dirty data), they run the same validators via a drift-inspection
tool (planned as `dsqlbase inspect`).

## Relation cardinality

Derived, not declared. A relation is non-null iff its foreign-key column is
`.notNull()` in the schema:

```ts
// schema:
posts.author_id = uuid().notNull();
// → post.author: User   (required)

posts.editor_id = uuid(); // no .notNull()
// → post.editor: User | null
```

No separate "required: true" on the relation. One source of truth.

## The uniqueness exception

App-level uniqueness has an unavoidable TOCTOU race under concurrent writers: two
inserts both check "not taken," both proceed, both commit. No amount of validator
code fixes this without a distributed lock primitive DSQL doesn't expose.

So `.unique()` materializes as a **DB-level guarantee**. The migrator's job:

- On `CREATE TABLE` or later — emit `CREATE UNIQUE INDEX ASYNC` to build the
  index.
- Once the index is `VALID`, emit `ALTER TABLE … ADD CONSTRAINT … UNIQUE USING
INDEX` to promote it into a true uniqueness constraint (DSQL supports this per
  the `table_constraint_using_index` syntax).

This path works both for new tables (inline during creation) and for columns
added later — uniqueness is the one column-level semantic that evolves cleanly
at the DB layer in DSQL.

Violations surface as DB errors on insert/update. The ORM wraps them into the
same `{ column, value, message }` shape as semantic validators, so callers see
a uniform error surface.

## Raw-SQL bypass

A user running `psql` can `INSERT … VALUES (…)` with a `NULL` in a column the
schema declares `notNull`. The dirty row exists until someone queries it, at
which point the cascade-null-upward policy drops it from ORM results.

This is a real gap, but:

1. It mirrors every ORM that has app-level defaults, soft deletes, polymorphic
   columns, or computed fields.
2. `dsqlbase inspect` (planned) surfaces drift: _"`posts.author_id` contract is
   `notNull`; DB has 3 violating rows."_ Users who care can clean up.
3. Applications generally don't have two writers of different provenance; the ORM
   is the sole writer, so the bypass is narrow in practice.

## Summary

- **Schema definition** is the single source of truth for the contract.
- **DB** enforces shape (tables, columns, types, primary keys, indexes) +
  uniqueness.
- **ORM** enforces nullability, defaults, checks, relation cardinality — at
  write time (validation) and read time (cascade-null-upward).
- **Migration** reconciles shape only; never fails because of semantics.
- **API stays uniform** — `.notNull()` means the same thing whether a column is
  declared on day 1 or day 300. No split between "creation" and "evolution"
  columns.

## Open questions

1. **Read-policy granularity.** Default is cascade-null-upward. Do we want a
   per-column override (`.notNull({ onViolation: "throw" })`) before MVP ships, or
   defer until users ask?
2. **Counts & pagination.** Which of the three stances above do we adopt?
3. **Raw-SQL bypass detection.** Should `dsqlbase inspect` run automatically on a
   schedule or only on demand?
4. **Validator execution order.** If a column has `$onCreate` + `.check(…)`, does
   the check run on the provided value _or_ on the post-`$onCreate` value?
   (Recommendation: post-hook — check what actually lands.)
5. **Unique columns with existing non-unique data.** If a user adds `.unique()`
   to an existing column that already has duplicates, `CREATE UNIQUE INDEX ASYNC`
   will fail. Do we surface a pre-check in `dsqlbase inspect` to warn before the
   migration attempt?
