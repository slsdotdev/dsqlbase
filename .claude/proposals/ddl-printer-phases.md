# DDL Printer — Post-MVP Phases

## Overview

[ddl-ast-catalog.md](./ddl-ast-catalog.md) cataloged every DDL node the printer eventually needs. The MVP phase (tables, columns, table-level constraints, indexes) is implemented and tested. This proposal sequences the remaining work, excluding `VIEW` and `FUNCTION` commands which stay out of scope for now.

Principles carried over from the catalog:

- AST stays structurally close to the serialized JSON; field-level translation lives in the [serialized → AST adapter](./ddl-serialized-adapter.md), not in the factory or printer.
- Pre-escaped SQL string fields (defaults, check expressions, ownedBy) pass through the printer raw — identifiers get quoted, expressions don't.
- `satisfies Partial<Reducer>` keeps the reducer incomplete-but-typed; new resolvers land one at a time.
- DSQL coverage assumption: features not listed as unsupported are assumed available.

---

## Scope

In scope (in phase order):

1. `CREATE_SCHEMA`, `DROP_SCHEMA`
2. `CASCADE` flag on existing drops (`DROP_TABLE`, `DROP_INDEX`)
3. `SEQUENCE_OPTIONS` expression, `CREATE_SEQUENCE`, `DROP_SEQUENCE`, `ALTER_SEQUENCE`
4. `CREATE_DOMAIN`, `DROP_DOMAIN`
5. `IDENTITY_CONSTRAINT`, `GENERATED_EXPRESSION`; extension of `COLUMN_DEFINITION`
6. `ALTER_COLUMN` + `ALTER_DOMAIN` holders and their shared sub-action base
7. `RENAME`, `RENAME_COLUMN`, `RENAME_CONSTRAINT`, `SET_SCHEMA` (table-level)
8. `ALTER_INDEX`

Out of scope (deferred):

- `CREATE_VIEW` / `ALTER_VIEW` / `DROP_VIEW`
- `CREATE_FUNCTION` / `ALTER_FUNCTION` / `DROP_FUNCTION`
- `LIKE_CLAUSE` (niche, unlikely from an ORM)

---

## Cross-cutting design decisions

### `CASCADE` / `RESTRICT`

Add a shared optional flag wherever DSQL accepts it. Postgres (and DSQL) accepts `CASCADE`/`RESTRICT` on `DROP TABLE`, `DROP INDEX`, `DROP SCHEMA`, `DROP DOMAIN`, `DROP SEQUENCE`. Shape:

```ts
// Mixed into every Drop* command:
cascade?: "CASCADE" | "RESTRICT";
```

String union rather than boolean so callers can be explicit; `undefined` emits neither keyword (server default).

### No factory-level validation

Validations like the DSQL `CACHE` rule (`1` or `>= 65536`) don't live in the factory. They belong in a separate validation pass (to be scoped later) that runs over the serialized schema or AST. Keeps factories pure and lets tests inject any AST shape.

### `ALTER_COLUMN` as a sub-action holder

`ALTER_COLUMN` stays a general-purpose container, not a specific identity-only action:

```ts
interface AlterColumnAction extends DDLStatement {
  __kind: "ALTER_COLUMN";
  columnName: string;
  actions: AlterColumnSubAction[];
}
```

Emits `ALTER COLUMN "c" <sub1>, ALTER COLUMN "c" <sub2>` when multiple sub-actions are present. In practice the differ emits one sub-action per holder to match the "one ALTER TABLE per statement" convention, but the AST doesn't force it — this keeps the door open for batched `ALTER COLUMN` edits if we relax the rule later.

### Shared sub-action base between `ALTER_COLUMN` and `ALTER_DOMAIN`

Both holders share the same "modify a nullable/default/constraint" vocabulary. Factor the overlap into reusable interfaces:

```
Shared sub-actions (used by both holders):
  SET_NOT_NULL         { __kind: "SET_NOT_NULL" }
  DROP_NOT_NULL        { __kind: "DROP_NOT_NULL" }
  SET_DEFAULT          { __kind: "SET_DEFAULT"; expression: string }  // pre-escaped
  DROP_DEFAULT         { __kind: "DROP_DEFAULT" }
  ADD_CONSTRAINT       { __kind: "ADD_CONSTRAINT"; constraint: CheckConstraintExpression }
  DROP_CONSTRAINT      { __kind: "DROP_CONSTRAINT"; name: string; ifExists?: boolean; cascade?: "CASCADE" | "RESTRICT" }
  RENAME_CONSTRAINT    { __kind: "RENAME_CONSTRAINT"; from: string; to: string }

ALTER_COLUMN only:
  SET_DATA_TYPE        { __kind: "SET_DATA_TYPE"; dataType: string; using?: string }
  SET_GENERATED        { __kind: "SET_GENERATED"; mode: "ALWAYS" | "BY_DEFAULT"; options?: SequenceOptions }
  RESTART              { __kind: "RESTART"; with?: number }
  DROP_IDENTITY        { __kind: "DROP_IDENTITY"; ifExists?: boolean }

ALTER_DOMAIN only:
  VALIDATE_CONSTRAINT  { __kind: "VALIDATE_CONSTRAINT"; name: string }
```

Unions:

```ts
type SharedModifyAction =
  | SetNotNullSubAction
  | DropNotNullSubAction
  | SetDefaultSubAction
  | DropDefaultSubAction
  | AddConstraintSubAction
  | DropConstraintSubAction
  | RenameConstraintSubAction;

type AlterColumnSubAction =
  | SharedModifyAction
  | SetDataTypeSubAction
  | SetGeneratedSubAction
  | RestartSubAction
  | DropIdentitySubAction;

type AlterDomainSubAction =
  | SharedModifyAction
  | ValidateConstraintSubAction;
```

Note: `ALTER_TABLE` already has top-level `RENAME`/`RENAME_CONSTRAINT` actions (phase 7). The shared `RENAME_CONSTRAINT` sub-action is the one that applies *inside* `ALTER_DOMAIN`/`ALTER_COLUMN`; it's named the same but lives at a different AST position. We disambiguate via the `__kind` discriminator since TypeScript's structural typing doesn't mind reuse.

### Identity and generated columns

Both are column-body children that extend `COLUMN_DEFINITION`:

```ts
interface ColumnDefinitionExpression {
  ...existing fields
  identity?: IdentityConstraintExpression;
  generated?: GeneratedColumnExpression;
}

interface IdentityConstraintExpression extends DDLStatement {
  __kind: "IDENTITY_CONSTRAINT";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;  // shared with CREATE_SEQUENCE
}

interface GeneratedColumnExpression extends DDLStatement {
  __kind: "GENERATED_EXPRESSION";
  expression: string;  // pre-escaped SQL
  stored: true;        // only STORED in DSQL/Postgres; kept explicit for future VIRTUAL
}
```

`SequenceOptionsExpression` is shared between `CREATE_SEQUENCE`, `ALTER_SEQUENCE` (partially), `IDENTITY_CONSTRAINT`, and the `SET_GENERATED` sub-action — one shape, four call sites.

---

## Phases

Each phase: AST interfaces → factory functions → printer resolvers → unit tests. One phase ≈ one PR.

### Phase 1 — Schemas

**Nodes:** `CREATE_SCHEMA`, `DROP_SCHEMA`.

```ts
interface CreateSchemaCommand extends DDLStatement {
  __kind: "CREATE_SCHEMA";
  name: string;
  ifNotExists?: boolean;
}

interface DropSchemaCommand extends DDLStatement {
  __kind: "DROP_SCHEMA";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}
```

**Printer:**
```
CREATE SCHEMA [IF NOT EXISTS] "name"
DROP SCHEMA [IF EXISTS] "name" [CASCADE|RESTRICT]
```

**Tests:** 4 cases per node (presence/absence of flags).

### Phase 2 — `CASCADE` on existing drops

Extend `DropTableCommand` and `DropIndexCommand` with `cascade?: "CASCADE" | "RESTRICT"`. Update their resolvers to append the keyword after the identifier. Add tests per command covering `CASCADE`, `RESTRICT`, and unset.

No new factories — mutation of existing interfaces only.

### Phase 3 — Sequences

**Shared expression:**
```ts
interface SequenceOptionsExpression extends DDLStatement {
  __kind: "SEQUENCE_OPTIONS";
  dataType?: string;     // AS <type>
  startValue?: number;   // START WITH
  incrementBy?: number;  // INCREMENT BY
  minValue?: number;     // MINVALUE
  maxValue?: number;     // MAXVALUE
  cache?: number;        // CACHE
  cycle?: boolean;       // CYCLE / NO CYCLE
  ownedBy?: string;      // OWNED BY <expr>; pre-escaped
}
```

Printer emits clauses in Postgres's canonical order, skipping undefined fields. `cycle` prints `CYCLE` or `NO CYCLE` only when explicitly set.

**Commands:**
```ts
interface CreateSequenceCommand extends DDLStatement {
  __kind: "CREATE_SEQUENCE";
  name: string;
  ifNotExists?: boolean;
  options?: SequenceOptionsExpression;
}

interface DropSequenceCommand extends DDLStatement {
  __kind: "DROP_SEQUENCE";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}

interface AlterSequenceCommand extends DDLStatement {
  __kind: "ALTER_SEQUENCE";
  name: string;
  options?: SequenceOptionsExpression;
  restart?: { with?: number };  // RESTART [WITH n] — distinct from START WITH
}
```

**Printer output:**
```
CREATE SEQUENCE [IF NOT EXISTS] "name" <options>
DROP SEQUENCE [IF EXISTS] "name" [CASCADE|RESTRICT]
ALTER SEQUENCE "name" <options> [RESTART [WITH n]]
```

**Tests:** each sequence-option field in isolation, a full sequence with every option, `RESTART` with and without a value, and one round-trip test using the serialized sequence shape from `schema.json`.

### Phase 4 — Domains (create/drop)

Defer `ALTER_DOMAIN` to phase 6 where it inherits the shared sub-action base.

```ts
interface CreateDomainCommand extends DDLStatement {
  __kind: "CREATE_DOMAIN";
  name: string;
  dataType: string;       // pre-escaped
  notNull?: boolean;
  defaultValue?: string;  // pre-escaped; undefined → no DEFAULT clause
  check?: CheckConstraintExpression;
}

interface DropDomainCommand extends DDLStatement {
  __kind: "DROP_DOMAIN";
  name: string;
  ifExists?: boolean;
  cascade?: "CASCADE" | "RESTRICT";
}
```

**Printer output:**
```
CREATE DOMAIN "name" AS <dataType> [NOT NULL] [DEFAULT <expr>] [CONSTRAINT ...]
DROP DOMAIN [IF EXISTS] "name" [CASCADE|RESTRICT]
```

**Tests:** reproduces the two domains from `schema_create.sql` (`task_status` with inline check, `priority_level` with default + not null).

### Phase 5 — Identity and generated column expressions

Add the two expression nodes plus the `COLUMN_DEFINITION` extension. No new commands yet — this is pure expression work so `CREATE_TABLE` starts emitting richer columns.

```ts
interface IdentityConstraintExpression extends DDLStatement {
  __kind: "IDENTITY_CONSTRAINT";
  mode: "ALWAYS" | "BY_DEFAULT";
  options?: SequenceOptionsExpression;
}

interface GeneratedColumnExpression extends DDLStatement {
  __kind: "GENERATED_EXPRESSION";
  expression: string;  // pre-escaped
  stored: true;
}
```

`COLUMN_DEFINITION` gains `identity?` and `generated?` optional children. Printer ordering inside the column body:

```
"name" <dataType>
  [GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY (options)]  | identity
  [GENERATED ALWAYS AS (expr) STORED]                     | generated
  [NOT NULL] [UNIQUE] [PRIMARY KEY] [DEFAULT expr] [CHECK ...]
```

Identity and generated are mutually exclusive in SQL, but we don't enforce it at the AST level — validation pass handles it later.

**Open:** the column definition layer in `packages/core` doesn't yet model identity or generated columns. This phase adds printer support ahead of the definition work; the serialized adapter will start emitting these nodes once the definition layer catches up. Flagged as a deliberate lead.

**Tests:** identity column with and without options; generated column; full `orders` example with identity PK.

### Phase 6 — `ALTER_COLUMN` + `ALTER_DOMAIN` holders

Introduce the shared sub-action interfaces (listed above), then the two holders:

```ts
interface AlterColumnAction extends DDLStatement {
  __kind: "ALTER_COLUMN";
  columnName: string;
  actions: AlterColumnSubAction[];
}

interface AlterDomainCommand extends DDLStatement {
  __kind: "ALTER_DOMAIN";
  name: string;
  actions: AlterDomainSubAction[];
}
```

`ALTER_COLUMN` is an ALTER TABLE sub-action (lives inside `AlterTableCommand.actions`). `ALTER_DOMAIN` is a top-level command.

**Printer output:**

```
ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL, ALTER COLUMN "c" SET DEFAULT <expr>
ALTER DOMAIN "d" SET NOT NULL, ADD CONSTRAINT <check>, VALIDATE CONSTRAINT "chk_x"
```

Sub-action resolvers are small — each emits one fragment. The holder joins fragments with `, ` and prepends the column/domain context.

**Resolver dispatch nuance:** sub-action resolvers run in the same reducer as top-level commands, keyed by `__kind`. To avoid collision, sub-action `__kind` values are prefixed where they'd overlap with existing commands (e.g. sub-action `SET_SCHEMA` vs top-level `SET_SCHEMA` ALTER TABLE action — use `ALTER_COLUMN_SET_SCHEMA` / `ALTER_DOMAIN_SET_SCHEMA`). Actual naming TBD per-action during implementation.

**Tests:** each sub-action in isolation; one mixed column alter (SET NOT NULL + SET DEFAULT) to verify comma joining; one identity-oriented column alter (SET GENERATED + RESTART); one full ALTER_DOMAIN touching every sub-action.

### Phase 7 — Rename / move ALTER TABLE actions

```ts
interface RenameTableAction extends DDLStatement {
  __kind: "RENAME";        // table-level rename
  to: string;
}

interface RenameColumnAction extends DDLStatement {
  __kind: "RENAME_COLUMN";
  from: string;
  to: string;
}

interface RenameConstraintTableAction extends DDLStatement {
  __kind: "RENAME_CONSTRAINT";
  from: string;
  to: string;
}

interface SetSchemaAction extends DDLStatement {
  __kind: "SET_SCHEMA";
  schema: string;
}
```

**Printer output:**
```
ALTER TABLE "t" RENAME TO "new"
ALTER TABLE "t" RENAME COLUMN "a" TO "b"
ALTER TABLE "t" RENAME CONSTRAINT "a" TO "b"
ALTER TABLE "t" SET SCHEMA "s"
```

**Tests:** one per action.

### Phase 8 — `ALTER_INDEX`

```ts
interface AlterIndexCommand extends DDLStatement {
  __kind: "ALTER_INDEX";
  name: string;
  action:
    | { __kind: "RENAME"; to: string }
    | { __kind: "SET_SCHEMA"; schema: string };
}
```

Narrow on purpose — Postgres/DSQL `ALTER INDEX` has very little surface.

**Printer output:**
```
ALTER INDEX "i" RENAME TO "new"
ALTER INDEX "i" SET SCHEMA "s"
```

**Tests:** one per variant.

---

## Testing strategy

- Unit tests per resolver, mirroring the existing `printer.test.ts` structure.
- Per phase, one end-to-end test building a realistic AST from the serialized JSON under `packages/tests/src/schema/data/schema.json` and matching against the expected SQL in `packages/tests/src/schema/migrations/schema_create.sql` (for phases that contribute to the create path).
- No fixture tests for `ALTER_*` paths yet — the differ will produce those and own their fixtures.

## File layout after phase 8

```
packages/schema/src/migration/ddl/
├── ast.ts           (extended — 9 new command interfaces, 1 action, 2 expressions, ~10 sub-actions)
├── factory.ts       (extended — matching factories)
├── printer.ts       (extended — matching resolvers)
├── printer.test.ts  (extended)
├── adapter.ts       (separate proposal; not touched here)
└── schema.ts        (updated to emit the new command types once adapter lands)
```

## Open questions

1. **Identity/generated ahead of the definition layer.** Phase 5 adds printer support before `CoreTable/CoreColumn` model identity or generated columns. Is that acceptable, or should phase 5 wait until the definition work is scoped?
2. **Sub-action naming.** Do we prefix column/domain-scoped sub-action kinds (e.g. `ALTER_COLUMN_SET_NOT_NULL`) to keep a global-unique `__kind` space, or rely on context and reuse short names? My default is short names — the reducer dispatch already reads `statement.__kind` within a known parent, so collision isn't a practical issue if we route sub-actions through a separate mini-reducer in the holder's resolver rather than the global reducer. Happy to flip this if global-unique is preferred.
3. **`ALTER_DOMAIN` functional subset.** Listed every Postgres sub-action above. If the differ's v1 only emits a smaller slice (likely `SET/DROP NOT NULL`, `SET/DROP DEFAULT`, `ADD/DROP CONSTRAINT`), we could scope phase 6 tighter and add `VALIDATE_CONSTRAINT` / `RENAME_CONSTRAINT` later. Lean toward implementing all of them now — incremental cost is small once the holder is in place.
4. **`SequenceOptionsExpression` for `ALTER_SEQUENCE`.** Postgres's `ALTER SEQUENCE` accepts all the same options as `CREATE SEQUENCE` plus `RESTART`. Reusing the same expression means some options (e.g. `dataType`) are valid in both contexts but stylistically rarer in alter. No enforcement needed — the AST allows both, validation pass can warn.
