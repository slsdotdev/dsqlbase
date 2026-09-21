# Select-tree aliasing

_Audience: contributors and agents._

Every level of a select tree is rendered under its own table alias. This page explains why that is necessary, how it works, and — the part that is easy to miss — how one predicate manages to reference the same table under two different aliases at once.

Decision record: [0003 — Table aliasing in select trees](../decisions/0003-select-tree-aliasing.md).

## The problem

A join is a `LEFT JOIN LATERAL` over a full sub-select (see [Runtime pipeline → Relations and joins](./runtime-pipeline.md#relations-and-joins)). Before aliasing, every column rendered as `"<table name>"."<column>"`, and the inner `FROM` re-declared the same correlation name as the outer one. Postgres then resolved **both** sides of the correlation to the inner table:

```sql
-- tasks.parent → tasks, as generated before this change
SELECT "tasks"."id", "__join_parent"."data" AS "parent" FROM "tasks"
LEFT JOIN LATERAL (
  SELECT row_to_json("__t".*) AS "data" FROM (
    SELECT "tasks"."id" FROM "tasks"
    WHERE "tasks"."parent_id" = "tasks"."id"   -- both bind to the INNER tasks
  ) AS "__t"
) AS "__join_parent" ON true
```

The predicate silently became `parent_id = id` on a single row. Postgres accepts it; the result is wrong.

The failing condition is **not** "a self-join". It is *two levels whose correlation names collide*, which happens in at least two ways:

| Shape | Broken before? |
|---|---|
| A join whose target is the same table as an ancestor level (`tasks.parent`) | yes |
| Two different tables sharing a name across schemas (`public.invoices` joined to `billing.invoices`) | yes — both qualified as `"invoices"` |
| The same table joined twice as **siblings** at one level (`assignee` and `reviewer`, both `users`) | no — sibling laterals have separate scopes |

Schema-qualifying column references does not fix either broken case. Postgres rejects `"billing"."invoices"."id"` outright once the source is aliased (`invalid reference to FROM-clause entry`), and disambiguating a shadowed subquery needs *both* sides qualified, which is impossible when one table has no declared namespace. Aliasing is the only fix that covers all of it.

## Where the decision is made

Aliasing is entirely owned by `QueryBuilder` (`packages/core/src/runtime/query.ts`). Nothing above it knows an alias exists:

| Layer | Knows about aliases? |
|---|---|
| `RequestNormalizer` (`packages/dsqlbase/src/client/model/normalizer.ts`) | no — unchanged by this work |
| `OperationsFactory` (`packages/core/src/runtime/operation.ts`) | no — it resolves a relation to column pairs and stops |
| `QueryBuilder` (`packages/core/src/runtime/query.ts`) | yes — allocates aliases, builds the correlation |

That placement is deliberate: the need for aliases arises purely from *how relations are rendered as lateral joins*, which is a query-builder concern.

## The two render forms of a table

`Table` (`packages/core/src/runtime/table.ts`) renders two ways, and the split is what makes the rest work:

| Form | Renders | Used for |
|---|---|---|
| **source** — `Table.toSQL` | `"billing"."invoices"` | `FROM`, `UPDATE`, `INSERT INTO` |
| **reference** — `Table.ref()` | the alias bound in context, else the bare name | qualifying a column |

A source answers *which table* and so carries the schema. A reference answers *which correlation in this query*, where the schema is not part of the name. `Column.toSQL` (`packages/core/src/runtime/column.ts`) asks for the reference form:

```ts
toSQL(ctx: SQLContext): SQLStatement {
  return sql.join([this.table.ref(), sql.identifier(this.name)], ".").toSQL(ctx);
}
```

so a column carries no alias of its own — its qualifier is decided entirely by what is wrapped around it when it renders.

## `SQLScope`

`SQLScope` (`packages/core/src/sql/nodes.ts`) is a wrapper node that **emits no text**. Its only job is to render its child with extra alias bindings in context:

```ts
toSQL(ctx: SQLContext): SQLStatement {
  const aliases = ctx.aliases ? new Map([...ctx.aliases, ...this._bindings]) : this._bindings;
  return this._node.toSQL({ ...ctx, aliases });
}
```

Two properties follow:

- **Dynamic extent, not lexical.** The bindings apply to everything reachable below the wrapper during rendering, however deep.
- **Innermost wins.** The spread puts `this._bindings` last, so a nested scope overrides an outer one for the same key.

Because `ctx` is a parameter rather than shared mutable state, nesting is just "render the child with a different object" — there is no stack to push and pop, and no constraint on the order in which nodes render.

`SQLContext.aliases` is `ReadonlyMap<unknown, string>`. The keys are opaque to `sql/`, which is what keeps that layer free of any dependency on `runtime/`. In practice the key is the runtime `Table` instance, and `TableRef` looks itself up by identity.

## Walkthrough: how the parent's alias reaches inside the subquery

This is the part that is not obvious from reading `_buildCorrelation` alone, because the injection happens in one place and takes effect in another.

Take `tasks.parent → tasks`, a self-join. Both levels are the *same* `Table` object.

**1. Each level allocates an alias and binds its own table.** In `_buildSelect`:

```ts
const tableAlias = alloc.table();                                    // "__t0", then "__t1", …
const scope: ReadonlyMap<unknown, string> = new Map([[table, tableAlias]]);
const scoped = (node: SQLNode) => new SQLScope(scope, node);
```

**2. The parent wraps its own clauses, and passes its `scope` down to the join.**

```ts
query.append(sql` ${selection} FROM ${table} AS ${sql.identifier(tableAlias)}`);
//                 ^ scoped columns        ^ source form — deliberately NOT wrapped
this._buildLateralJoin(joinEntry, scope, alloc)   // ← the parent's bindings travel here
```

**3. `_buildCorrelation` wraps only the parent-side column.** This is the injection point:

```ts
const pairs = join.to.map((to, index) => sql.eq(to, new SQLScope(parentScope, join.from[index])));
```

`join.to[i]` (the child's column) is left bare. `join.from[i]` (the parent's column) is wrapped in the **parent's** scope. At this moment neither has rendered; the wrapper is just sitting in the tree.

**4. The correlation is merged into the child's `where` — *before* the child builds.**

```ts
const correlation = this._buildCorrelation(join, parentScope);
const where = join.params.where ? sql.and([correlation, sql.wrap(join.params.where)]) : correlation;
const innerQuery = this._buildSelect({ ...join.params, where }, alloc);
```

So the correlation becomes an ordinary part of the child's `WHERE`.

**5. The child wraps its whole `where` in *its* scope**, correlation included:

```ts
query.append(sql` WHERE ${scoped(where)}`);
```

The tree now looks like this, and the aliases fall out of the nesting depth:

```
Scope B { tasks → "__t1" }          ← child wraps its entire WHERE
  └ eq(
      to   = tasks.id               → no nearer binding, so B applies   → "__t1"."id"
      from = Scope A { tasks → "__t0" }   ← inner, so it overrides B
               └ tasks.parentId                                        → "__t0"."parent_id"
    )
```

```sql
WHERE "__t1"."id" = "__t0"."parent_id"
```

The parent-side wrapper is *deeper* in the tree than the child's wrapper, so it wins — even though it carries the outer query's alias. One `Table` object, two aliases, decided purely by wrapping depth.

## What is wrapped, and what is not

Per level, exactly four things:

| Node | Scope | Why |
|---|---|---|
| `select` columns | own | qualify against this level |
| `where` | own | includes the correlation merged in by the parent |
| `orderBy` | own | qualify against this level |
| correlation's parent-side column | **parent's** | pinned before the child's scope is applied |
| `FROM <table>` | **none** | source form; wrapping it would name the source by the alias it is about to declare |

`LIMIT` / `OFFSET` are parameters and qualify nothing.

## Aliases

Allocated per query build by `createAliasAllocator`, so `QueryBuilder` itself stays stateless and safe to share across a client:

- `__t<n>` — one per select level, in the order levels are built.
- `__j<n>` — one per JSON wrapper in a lateral join, replacing the fixed `"__t"` that every wrapper used to share.

The two counters are independent, so the wrapper inside level `__t1` is `__j0`.

## Outside a select tree

Nothing binds an alias, so `TableRef` falls back to the table name and output is unchanged from before this work:

- `UPDATE` / `DELETE` / `INSERT ... RETURNING` — one table in scope, `"tasks"."id"` is unambiguous.
- `$query` with the `sql` tag — `${users.columns.id}` still renders `"users"."id"`.

`SQLScope` is not on the `sql` tag or in the `./sql` barrel: its bindings are keyed by the node objects the builder threads through a select tree, which is not knowledge a caller can be expected to have. Hand-written SQL therefore has **no supported way to alias a table** — a raw self-join is as broken as it ever was. A user-facing aliasing API is a separate thing to design.

## Related

- [Runtime pipeline](./runtime-pipeline.md)
- [Relations (guide)](../guide/relations.md)
- [Decision 0003 — Table aliasing in select trees](../decisions/0003-select-tree-aliasing.md)
