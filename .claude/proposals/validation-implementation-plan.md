# Validation — Implementation Plan

Companion to `migrations-module-mvp.md` §2. Turns the validation design into
a concrete implementation sequence.

## Scope

Structural rules on the local serialized schema. Zero DB calls. Output is a
list of typed issues, partitioned into errors (blocking) and warnings.

Out of scope: runtime data validation, drift detection against a remote DB,
per-user rule suppression.

## File layout

```
packages/schema/src/migration/validation/
  index.ts           — public exports
  validate.ts        — orchestrator: dispatch rules by node.kind
  validate.test.ts   — integration tests over the full validator
  context.ts         — ValidationContext builder + type
  codes.ts           — error code constants (single source of truth)
  types.ts           — ValidationIssue, ValidationResult, Rule
  rules/
    table.ts         — TABLE-kind rules
    table.test.ts    — one test block per rule in this file
    schema.ts        — SCHEMA-kind rules
    schema.test.ts
    domain.ts        — DOMAIN-kind rules
    domain.test.ts
    global.ts        — cross-node rules (duplicates across namespaces, relation targets)
    global.test.ts
    index.ts         — aggregates per-kind arrays into the dispatch registry
```

Tests live next to the files they exercise (project convention). One `describe`
block per rule inside each kind's test file.

## Core types (`types.ts`)

```ts
import type { CODES } from "./codes.js";
import type { NodeKind, SerializedObjectByKind, SerializedSchema } from "...";

export type ValidationCode = keyof typeof CODES;

export interface ValidationIssue {
  level: "error" | "warning";
  code: ValidationCode;
  path: string[];          // e.g. ["public", "users", "columns", "email"]
  message: string;
  hint?: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];       // derived: level === "error"
  warnings: ValidationIssue[];     // derived: level === "warning"
  isValid: boolean;                // errors.length === 0
}

export type Rule<K extends NodeKind = NodeKind> = (
  node: SerializedObjectByKind<K>,
  context: ValidationContext,
) => ValidationIssue[];

export type GlobalRule = (context: ValidationContext) => ValidationIssue[];
```

## Error codes (`codes.ts`)

Single typed const map. No stringly-typed usage anywhere in the module.

```ts
export const CODES = {
  // Blocking
  TABLE_NO_PRIMARY_KEY:        "TABLE_NO_PRIMARY_KEY",
  DUPLICATE_NAME:              "DUPLICATE_NAME",
  UNKNOWN_COLUMN_REFERENCE:    "UNKNOWN_COLUMN_REFERENCE",
  EMPTY_CONSTRAINT_COLUMNS:    "EMPTY_CONSTRAINT_COLUMNS",
  IDENTIFIER_TOO_LONG:         "IDENTIFIER_TOO_LONG",
  UNSUPPORTED_TYPE:            "UNSUPPORTED_TYPE",
  FOREIGN_KEY_DECLARED:        "FOREIGN_KEY_DECLARED",
  RELATION_TARGET_MISSING:     "RELATION_TARGET_MISSING",
  RESERVED_NAMESPACE:          "RESERVED_NAMESPACE",

  // Warning
  REDUNDANT_UNIQUE_ON_PK:      "REDUNDANT_UNIQUE_ON_PK",
  DUPLICATE_INDEX_COVERAGE:    "DUPLICATE_INDEX_COVERAGE",
  UNQUOTED_IDENTIFIER_RISK:    "UNQUOTED_IDENTIFIER_RISK",
  VARCHAR_WITHOUT_LENGTH:      "VARCHAR_WITHOUT_LENGTH",
  ORM_SIDE_CONSTRAINT_IGNORED: "ORM_SIDE_CONSTRAINT_IGNORED",
  NO_INDEX_ON_RELATION_FK:     "NO_INDEX_ON_RELATION_FK",
} as const;
```

## Context (`context.ts`)

Built once per `validate()` call. Prebuilt lookups so rules don't each re-walk
the schema.

```ts
export interface ValidationContext {
  schema: SerializedSchema;
  byKey: Map<string, SerializedObject>;           // "namespace.name" → object
  tablesByNamespace: Map<string, TableJson[]>;
  namespaces: Set<string>;                         // declared SCHEMA kinds + "public"
  // Reserved; add as rules demand.
}

export function buildContext(schema: SerializedSchema): ValidationContext;
```

Adding a new prebuilt index is a one-liner. Rules that need a new lookup
extend `ValidationContext` + `buildContext`; no other rules care.

## Orchestrator (`validate.ts`)

```ts
import { rulesByKind, globalRules } from "./rules/index.js";

export function validate(schema: SerializedSchema): ValidationResult {
  const context = buildContext(schema);
  const issues: ValidationIssue[] = [];

  for (const node of schema) {
    const kindRules = rulesByKind[node.kind] ?? [];
    for (const rule of kindRules) {
      issues.push(...rule(node as never, context));
    }
  }
  for (const rule of globalRules) {
    issues.push(...rule(context));
  }

  return toResult(issues);
}

function toResult(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter(i => i.level === "error");
  const warnings = issues.filter(i => i.level === "warning");
  return { issues, errors, warnings, isValid: errors.length === 0 };
}
```

Deterministic ordering: schema-object iteration order, then per-kind rule
registration order. Makes test assertions stable.

## Rule registry (`rules/index.ts`)

```ts
import * as table from "./table.js";
import * as schema from "./schema.js";
import * as domain from "./domain.js";
import * as global from "./global.js";

export const rulesByKind = {
  TABLE: [
    table.tableNoPrimaryKey,
    table.duplicateColumnNames,
    table.duplicateIndexNames,
    table.duplicateConstraintNames,
    table.unknownColumnReference,
    table.emptyConstraintColumns,
    table.identifierTooLong,
    table.unsupportedType,
    table.foreignKeyDeclared,
    table.redundantUniqueOnPk,        // warning
    table.duplicateIndexCoverage,     // warning
    table.unquotedIdentifierRisk,     // warning
    table.varcharWithoutLength,       // warning
    table.ormSideConstraintIgnored,   // warning
    table.noIndexOnRelationFk,        // warning
  ],
  SCHEMA: [schema.reservedNamespace],
  DOMAIN: [domain.unsupportedType, domain.identifierTooLong],
} satisfies { [K in NodeKind]?: Rule<K>[] };

export const globalRules: GlobalRule[] = [
  global.duplicateTablesInNamespace,
  global.relationTargetMissing,
];
```

## Rule examples

```ts
// rules/table.ts
import { CODES } from "../codes.js";
import type { Rule } from "../types.js";

export const tableNoPrimaryKey: Rule<"TABLE"> = (table) => {
  const hasColumnPk = table.columns.some(c => c.primaryKey);
  const hasTablePk = table.constraints?.some(c => c.kind === "PRIMARY_KEY_CONSTRAINT");
  if (hasColumnPk || hasTablePk) return [];
  return [{
    level: "error",
    code: CODES.TABLE_NO_PRIMARY_KEY,
    path: [table.namespace, table.name],
    message: `Table "${table.name}" has no primary key.`,
    hint: `Call .primaryKey() on a column or declare a composite PRIMARY_KEY_CONSTRAINT.`,
  }];
};

export const unknownColumnReference: Rule<"TABLE"> = (table) => {
  const issues: ValidationIssue[] = [];
  const columnNames = new Set(table.columns.map(c => c.name));

  for (const c of table.constraints ?? []) {
    if (c.kind !== "CHECK_CONSTRAINT") {
      for (const col of c.columns) {
        if (!columnNames.has(col)) issues.push({
          level: "error",
          code: CODES.UNKNOWN_COLUMN_REFERENCE,
          path: [table.namespace, table.name, "constraints", c.name ?? "<anonymous>"],
          message: `Constraint references unknown column "${col}".`,
        });
      }
    }
  }
  for (const idx of table.indexes ?? []) {
    for (const ic of idx.columns) {
      if (!columnNames.has(ic.column)) issues.push({
        level: "error",
        code: CODES.UNKNOWN_COLUMN_REFERENCE,
        path: [table.namespace, table.name, "indexes", idx.name],
        message: `Index "${idx.name}" references unknown column "${ic.column}".`,
      });
    }
  }
  return issues;
};
```

All rules follow the same shape: pure function, returns zero-or-more
`ValidationIssue`, no side effects.

## Runner integration

```ts
// In MigrationRunner.run()
const validation = validate(definition);
if (validation.errors.length > 0) {
  throw new ValidationError(validation);
}
if (options?.abortOnWarning && validation.warnings.length > 0) {
  throw new ValidationError(validation);
}
```

`ValidationError extends Error` carries `.result: ValidationResult` so callers
can introspect and render issue lists.

## Phasing

Three PRs. Each one merges independently; each one passes CI on its own.

### PR 1 — Framework + critical 3 rules

Goal: prove the pattern end-to-end; unblock runner integration.

- `types.ts`, `codes.ts` (initial codes), `context.ts`, `validate.ts`.
- `rules/index.ts` aggregator.
- 3 rules: `tableNoPrimaryKey`, `unknownColumnReference`, `duplicateColumnNames`.
- `validate.test.ts` integration test with a mixed-issue schema.
- Per-rule tests in `rules/table.test.ts`.
- `ValidationError` class + export from `validation/index.ts`.

### PR 2 — Remaining blocking rules

- `emptyConstraintColumns`, `identifierTooLong`, `unsupportedType`,
  `foreignKeyDeclared`, `reservedNamespace`.
- Global rules: `duplicateTablesInNamespace`, `relationTargetMissing`.
- `duplicateIndexNames`, `duplicateConstraintNames` (same kind of check as
  columns; bundle here).
- Domain rules: `unsupportedType`, `identifierTooLong`.

### PR 3 — Warnings

- `redundantUniqueOnPk`, `duplicateIndexCoverage`, `unquotedIdentifierRisk`,
  `varcharWithoutLength`, `ormSideConstraintIgnored`, `noIndexOnRelationFk`.
- Extend integration test to assert warning partitioning.

## Test strategy

### Per-rule tests

Each rule gets a `describe("ruleName")` block in its kind's test file. Two
baseline cases:

- **Valid**: a minimal schema that satisfies the rule → `rule(...)` returns `[]`.
- **Violating**: a minimal schema that trips the rule → one issue with the
  expected `code`, correct `path`, correct `level`.

Rules with multiple failure modes (e.g. `unknownColumnReference` can trip on
constraints or indexes) get one case per mode.

### Integration test (`validate.test.ts`)

One realistic schema with 3–4 deliberate violations of different kinds.
Assertions:
- `result.issues.length` is exactly the expected count.
- `result.errors` and `result.warnings` partition correctly.
- `result.isValid` reflects `errors.length === 0`.
- Issue ordering is stable (schema order × registration order).

### Fixtures

A small set of factory helpers in `validation/fixtures.ts` (test-only, not
exported from the package):

```ts
export function makeTable(partial: Partial<TableJson>): TableJson;
export function makeColumn(partial: Partial<ColumnJson>): ColumnJson;
export function makeSchema(...objects: SerializedObject[]): SerializedSchema;
```

Keeps per-test setup to 3-5 lines.

## Non-goals (explicit)

- **Rule toggles at call time.** No `validate(schema, { disable: [...] })`
  in MVP. Users filter the result externally if they need suppression. Revisit
  only when a real use case shows up.
- **Severity overrides.** No promoting warnings to errors per-rule. The
  existing `abortOnWarning` flag in the runner handles the all-or-nothing case.
- **Async validation.** Rules are synchronous. If a future rule needs async
  (e.g. a remote lookup), that's a separate "extended validation" stage.

## Open questions

1. **`SerializedObjectByKind<K>` helper** — the type utility doesn't exist
   yet. Part of PR 1 will introduce it in `packages/schema/src/migration/base.ts`
   (or wherever the existing `SerializedObject` helper lives).
2. **Exact `UNSUPPORTED_TYPE` blocklist** — what's the canonical set of DSQL-
   unsupported types? The proposal lists `money`, `xml`, `tsvector`, range/
   inherited types. Need to confirm against DSQL type docs before PR 2.
3. **`IDENTIFIER_TOO_LONG` byte counting** — Postgres uses 63 *bytes*, not
   characters. UTF-8-safe length check. Trivial but worth noting.
