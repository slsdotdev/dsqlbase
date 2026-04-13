# Relations Definition API — Design Proposal

## Problem Statement

The ORM needs a way to define relationships between tables at the definition layer. Currently `RelationsDefinition` is a stub with `type: "one" | "many"` and no column reference fields. The test file shows intended usage but accesses `protected` members and uses fields that don't exist on the interface.

Two fundamental questions need answering:

1. **What do `from` and `to` mean?** — Does `from` always reference the source table, or the FK-holding table?
2. **How do we distinguish relation types?** — Is `"one"/"many"` sufficient, or do we need `hasOne`/`belongsTo`/`hasMany`?

---

## Decision 1: `from`/`to` Semantics

### The two options

**Option A — Source/Target (consistent direction):**
`from` always refers to columns on the source table (the one owning the `RelationsDefinition`), `to` always refers to columns on the target table.

```typescript
// user hasMany posts
// Source: users, Target: posts
// FK lives on posts.author_id
hasMany(posts, {
  from: [users.$columns.id],        // source column (PK)
  to:   [posts.$columns.authorId],   // target column (FK)
})

// post belongsTo user
// Source: posts, Target: users
// FK lives on posts.author_id
belongsTo(users, {
  from: [posts.$columns.authorId],   // source column (FK)
  to:   [users.$columns.id],         // target column (PK)
})
```

**Option B — FK-holder/Referenced (follows FK direction):**
`from` always refers to the FK-holding column, `to` always refers to the referenced column.

```typescript
// user hasMany posts — FK is on posts
hasMany(posts, {
  from: [posts.$columns.authorId],   // FK column (on target!)
  to:   [users.$columns.id],         // PK column (on source!)
})

// post belongsTo user — FK is on posts
belongsTo(users, {
  from: [posts.$columns.authorId],   // FK column (on source)
  to:   [users.$columns.id],         // PK column (on target)
})
```

### Analysis

| Criterion | Option A (source/target) | Option B (FK direction) |
|-----------|--------------------------|------------------------|
| **Consistency** | `from` is always "my columns", `to` is always "their columns" regardless of relation type | `from`/`to` meaning flips depending on whether FK is on source or target |
| **Cognitive load** | Low — one rule to remember | High — must mentally map FK placement per relation type |
| **Error surface** | Hard to mix up: you write the relation inside the source table's block, so `from` = my columns is natural | Easy to confuse: for `hasMany`, `from` points at the *target* table's column, which is counterintuitive when writing inside the source table's definition |
| **Type inference** | Clean — `from` is always constrained to source table columns, `to` to target table columns | Requires conditional types branching on relation kind to determine which table `from`/`to` should reference |
| **Precedent** | Drizzle ORM (`fields`/`references` always source/target), Prisma (`fields`/`references` on annotated model/related model) | Sequelize (`foreignKey`/`targetKey`), Django (FK declared on holder) |

### Recommendation: Option A

The strongest argument is **type safety**. With Option A, the type system can structurally enforce that `from` columns come from the source table and `to` columns come from the target table — no conditional types needed. With Option B, the constraint on `from` depends on the relation kind, which requires more complex type machinery and is easier to get wrong.

The existing test file already uses Option A semantics (though it has a bug in `postRelations.publication` — see appendix).

---

## Decision 2: Relation Kind Discriminant

### Why `"one"/"many"` is insufficient

Consider these two relations from `users`:

```typescript
// user hasOne profile → profiles.user_id references users.id
// user belongsTo organization → users.org_id references organizations.id
```

Both are cardinality "one" from the user's perspective, but the FK lives on different sides. The ORM needs to know which table holds the FK for:

- **JOIN generation** — `hasOne` joins `ON target.fk = source.pk`, `belongsTo` joins `ON source.fk = target.pk`
- **Cascade semantics** — deleting a user should cascade to the `hasOne` target (profile), not to the `belongsTo` target (organization)
- **Migration generation** — the FK constraint must be created on the correct table
- **Eager loading** — `hasOne` uses a subquery/join on the target, `belongsTo` can be resolved from already-loaded data

### Recommendation: Use `hasOne` / `belongsTo` / `hasMany`

The `kind` field explicitly encodes FK placement:

| Kind | FK lives on | `from` columns | `to` columns |
|------|-------------|----------------|--------------|
| `hasOne` | target | source PK/unique | target FK |
| `belongsTo` | source | source FK | target PK/unique |
| `hasMany` | target | source PK/unique | target FK |

This gives the ORM enough information to validate, generate SQL, and handle cascades without additional hints.

---

## Decision 3: API Shape — Helper Functions

### Why not raw object literals

The current test uses raw objects:

```typescript
relationships: {
  posts: {
    target: posts,
    type: "many",
    from: [users["_columns"].id],
    to: [posts["_columns"].authorId],
  },
}
```

Problems:
1. **No type inference for `from`/`to`** — TypeScript cannot infer that `from` should be constrained to the source table's columns from the outer `RelationsDefinition` generic context down into a nested object literal
2. **`kind` is a stringly-typed field** — easy to typo, no autocomplete benefit
3. **`_columns` is protected** — requires bracket notation to bypass

### Proposed API: Factory functions

```typescript
import { hasOne, belongsTo, hasMany, RelationsDefinition } from "@dsqlbase/core/definition";

const userRelations = new RelationsDefinition(users, {
  posts: hasMany(posts, {
    from: [users.$columns.id],
    to: [posts.$columns.authorId],
  }),
  publication: hasOne(publications, {
    from: [users.$columns.id],
    to: [publications.$columns.ownerId],
  }),
});

const postRelations = new RelationsDefinition(posts, {
  author: belongsTo(users, {
    from: [posts.$columns.authorId],
    to: [users.$columns.id],
  }),
  publication: belongsTo(publications, {
    from: [posts.$columns.publicationId],
    to: [publications.$columns.id],
  }),
});

const publicationRelations = new RelationsDefinition(publications, {
  owner: belongsTo(users, {
    from: [publications.$columns.ownerId],
    to: [users.$columns.id],
  }),
  posts: hasMany(posts, {
    from: [publications.$columns.id],
    to: [posts.$columns.publicationId],
  }),
  members: hasMany(publicationMemberships, {
    from: [publications.$columns.id],
    to: [publicationMemberships.$columns.publicationId],
  }),
});
```

Benefits:
- Each helper sets `kind` automatically — no string to get wrong
- Each helper is an inference site for generic parameters
- The `RelationsDefinition` constructor takes the table directly (not `tableName` + config with `table`) — less redundancy
- Clean `$columns` access via public getter

### Constructor simplification

Current:
```typescript
new RelationsDefinition(users.name, {
  table: users,
  relationships: { ... },
})
```

Proposed:
```typescript
new RelationsDefinition(users, {
  posts: hasMany(...),
  author: belongsTo(...),
})
```

The table reference and name are derived from the first argument. The relationships record is the second argument directly — no wrapper object.

---

## Decision 4: Public Column Access

### Problem

Columns are stored as `protected _columns` on `TableDefinition`. The test file uses `users["_columns"].id` to bypass the access modifier, which is fragile and signals a missing public API.

### Recommendation: `$columns` getter

```typescript
// In TableDefinition
get $columns(): TConfig["columns"] {
  return this._columns;
}
```

The `$` prefix follows Drizzle's convention for "type-level metadata accessors" (e.g., `table.$inferSelect`). It avoids collision with user-defined properties and signals "framework internal but public."

Usage:
```typescript
users.$columns.id          // ColumnDefinition<"id", { primaryKey: true, notNull: true, ... }>
posts.$columns.authorId    // ColumnDefinition<"author_id", { notNull: true, ... }>
```

---

## Type Definitions

```typescript
// --- Relation interfaces ---

interface HasOneRelation<TTarget extends AnyTableDefinition = AnyTableDefinition> {
  readonly kind: "hasOne";
  readonly target: TTarget;
  readonly from: ColumnDefinitionType[];
  readonly to: ColumnDefinitionType[];
}

interface BelongsToRelation<TTarget extends AnyTableDefinition = AnyTableDefinition> {
  readonly kind: "belongsTo";
  readonly target: TTarget;
  readonly from: ColumnDefinitionType[];
  readonly to: ColumnDefinitionType[];
}

interface HasManyRelation<TTarget extends AnyTableDefinition = AnyTableDefinition> {
  readonly kind: "hasMany";
  readonly target: TTarget;
  readonly from: ColumnDefinitionType[];
  readonly to: ColumnDefinitionType[];
}

type Relation =
  | HasOneRelation<AnyTableDefinition>
  | BelongsToRelation<AnyTableDefinition>
  | HasManyRelation<AnyTableDefinition>;

// --- Helper functions ---

function hasOne<TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: { from: ColumnDefinitionType[]; to: ColumnDefinitionType[] }
): HasOneRelation<TTarget>;

function belongsTo<TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: { from: ColumnDefinitionType[]; to: ColumnDefinitionType[] }
): BelongsToRelation<TTarget>;

function hasMany<TTarget extends AnyTableDefinition>(
  target: TTarget,
  config: { from: ColumnDefinitionType[]; to: ColumnDefinitionType[] }
): HasManyRelation<TTarget>;

// --- Updated RelationsDefinition ---

class RelationsDefinition<
  TTable extends AnyTableDefinition,
  TRelationships extends Record<string, Relation>,
> extends DefinitionNode<
  `${TTable extends TableDefinition<infer N, any> ? N : string}_relations`,
  { table: TTable; relationships: TRelationships }
> {
  readonly kind = Kind.RELATIONS;

  constructor(table: TTable, relationships: TRelationships);
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/definition/table.ts` | Add `$columns` getter |
| `packages/core/src/definition/relations.ts` | Rewrite with relation interfaces, helpers, updated class |
| `packages/core/src/definition/index.ts` | Export new relation types and helpers |
| `packages/core/src/definition/relations.test.ts` | Update to use new API, fix `post→publication` bug |

---

## Appendix: Bug in Current Test

In `relations.test.ts:83-84`, the post→publication relation is:

```typescript
publication: {
  target: publications,
  type: "one",
  from: [posts["_columns"].id],           // post.id
  to: [publications["_columns"].ownerId],  // publications.owner_id
}
```

This says "posts.id maps to publications.owner_id" — but `owner_id` references a *user*, not a post. A post belongs to a publication via `posts.publication_id → publications.id`. The corrected version:

```typescript
publication: belongsTo(publications, {
  from: [posts.$columns.publicationId],
  to: [publications.$columns.id],
}),
```
