# 0003 — Table aliasing in select trees

- **Date:** 2026-09-21
- **Status:** accepted provisionally — see [Open concerns](#open-concerns)
- **Proposal:** `.claude/proposals/schema-prerequisites.md` story 3; epic `.claude/epics/schema-prerequisites.md`

## Context

A relation join renders as `LEFT JOIN LATERAL` over a full sub-select, and every column rendered as `"<table name>"."<column>"`. When two levels of a select tree shared a correlation name, Postgres resolved both sides of the join predicate to the inner table and the correlation silently collapsed — `WHERE "tasks"."parent_id" = "tasks"."id"` on a single row, accepted and wrong.

This was listed as "No table aliasing in joins" in the runtime-pipeline gap table, described as affecting self-joins and "the same table twice at one level". Both halves of that description turned out to be wrong: sibling laterals at one level are fine (each has its own scope), while two *different* tables sharing a name across schemas break exactly like a self-join. The real condition is colliding correlation names, whatever produces them.

## Decision

- **`QueryBuilder` owns aliasing end to end.** Every select level renders `FROM <source> AS "__t<n>"`, and the JSON wrapper in each lateral join gets its own `"__j<n>"` instead of the fixed `"__t"` they all shared. Aliases are allocated per query build, so the builder stays stateless.
- **A table has two render forms.** `Table.toSQL` is the *source* (`"billing"."invoices"`; `FROM`, `UPDATE`, `INSERT INTO`, never aliased). `Table.ref()` is the *reference* (the alias bound in context, else the bare name) and is what `Column.toSQL` qualifies with. A column therefore carries no alias of its own.
- **`SQLScope` carries bindings down the render.** A wrapper node emitting no text, which renders its child with `SQLContext.aliases` extended. Scopes nest by deriving a context rather than mutating a stack, so the innermost binding for a key wins. Keys are `unknown` to `sql/`, keeping that layer independent of `runtime/`.
- **The join correlation moves from `OperationsFactory` into `QueryBuilder`.** Only the builder knows what each level is aliased as, and a self-join needs the two sides aliased differently. `OperationsFactory` now resolves a relation to column pairs and stops; `JoinParams.from`/`to` (previously written but never read) become `SQLNode[]` and carry them.
- **Nothing above the builder changed.** `RequestNormalizer` is untouched by this work.

## Rejected alternatives

- **`ColumnRef(column, scope)` threaded through the normalizer and operations factory** — made every producer of a column reference responsible for knowing its level, pushing a query-builder concern up two layers, and would have put a runtime type inside `sql/`.
- **Aliased `Table` clones (Drizzle's `IsAlias` approach)** — elegant, and every producer works unchanged, but requires cloning a table's columns per level per query.
- **An alias stack pushed and popped on `SQLContext`** — the original sketch. `SQLContext` is built inside `SQLQuery.toQuery()` and nodes render depth-first with no enter/exit signal, so a stack needs marker nodes around every level. Deriving a context per subtree achieves the same thing with no protocol.
- **Schema-qualifying column references instead of aliasing** — Postgres rejects `"billing"."invoices"."id"` once the source is aliased, and disambiguating a shadowed subquery needs *both* sides qualified, which is impossible for a table with no declared namespace. Verified against PGlite.
- **Aliasing only levels that actually collide** — whether a parent needs an alias depends on its descendants, so it needs a second analysis pass over the tree.

## Consequences

- **Every select's SQL text changes**, flat queries included: `SELECT "__t0"."id" FROM "users" AS "__t0"`. Behaviour is unchanged except that colliding levels now work. Changeset level `minor`.
- **Self-referential relations and same-name-across-schemas joins work.** Both were silently wrong.
- **`JoinParams.from`/`to` are arrays**, pulling the composite-pair half of story 4 forward rather than building the single-pair version twice.
- **Correlation order standardised to `child = parent`.** Previously `belongsTo` rendered `from = to` and other relation types `to = from`; the branch needed the relation type, which `JoinParams` does not carry. The predicate is identical either way.
- **No new public `sql` surface.** `SQLScope` is absent from the `sql` tag and the `./sql` barrel.
- **Hand-written SQL gains nothing.** A raw self-join through `$query` is as broken as before, and there is no supported way to alias a table in the `sql` tag. Unchanged, not worsened.
- **DML and `$query` output is byte-identical to before**, since nothing binds an alias outside a select tree.

## Open concerns

Recorded because this was accepted with reservations, not because it is known to be wrong. A future record supersedes this one if any of them forces a change.

1. **Readability of `__t<n>`.** Opaque aliases make a query log or `EXPLAIN` plan harder to read for a deep tree — you count levels to work out which alias is which table. A readable scheme (`__tasks_0`) was considered and not chosen.
2. **Unconditional aliasing.** Flat selects are aliased too, for uniformity and because later stories want a stable handle on every level. Restricting it to trees that contain a join is a one-line guard and would leave simple queries untouched.
3. **The correlation's two-scope trick is subtle.** The parent-side wrapper is applied in `_buildCorrelation` but only takes effect when the *child* wraps its `WHERE`, so the mechanism is not visible from either site alone. Walked through in [Select-tree aliasing](../internals/select-tree-aliasing.md#walkthrough-how-the-parents-alias-reaches-inside-the-subquery).
4. **No user-facing aliasing API.** Deliberately deferred rather than shipping `sql.scope` — its bindings are keyed by builder-internal node objects. `client-runtime-joins.md` wants ad-hoc joins and is the natural place to design one.

## Docs

- [Select-tree aliasing](../internals/select-tree-aliasing.md) — the full design, with the correlation walkthrough.
- [Runtime pipeline](../internals/runtime-pipeline.md) — gap row removed; the two incorrect claims about which shapes collide corrected.
- [Relations (guide)](../guide/relations.md) — self-referential relations are supported.
