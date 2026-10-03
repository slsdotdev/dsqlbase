import { DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { DDLStatement } from "../../ddl/index.js";
import { AnyDiff } from "../diffs/base.js";

export type DDLOperationOptions = {
  /**
   * Adds ASYNC modifier to CREATE INDEX operations.
   * @default true
   */
  asyncIndexes: boolean;

  /**
   * Adds `IF NOT EXISTS` / `IF EXISTS` to creates and drops. Drops are always `RESTRICT`.
   * @default true
   */
  ifExists: boolean;
};

export const DEFAULT_DDL_OPERATION_OPTIONS: DDLOperationOptions = {
  asyncIndexes: true,
  ifExists: true,
};

export type DDLOperationType = "CREATE" | "DROP" | "ALTER";

/**
 * What an operation risks, by whether redeploying the previous definition undoes it:
 * - `safe` — adds or relaxes; the previous definition can be restored.
 * - `lossy` — removes something redeploying restores (a default, an index, a constraint), so no
 *   row data is lost, but behaviour or performance is degraded until then. Also the drop of a
 *   column deprecated in an earlier release: `.deprecated()` already retired its data.
 * - `destructive` — cannot be undone by redeploying: row data is lost, or DSQL cannot re-create
 *   what was removed.
 */
export type OperationRisk = "safe" | "lossy" | "destructive";

export const RISK_ORDER: readonly OperationRisk[] = ["safe", "lossy", "destructive"];

/** The higher of two risks. */
export const maxRisk = (a: OperationRisk, b: OperationRisk): OperationRisk =>
  RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;

export type OperationAction =
  | "CREATE"
  | "ADD"
  | "ALTER"
  | "DROP"
  | "RENAME"
  | "VALIDATE"
  | "BACKFILL";

/** A schema object a plan row is about: the table a column belongs to, or the object itself. */
export type OperationSubject = {
  kind: "SCHEMA" | "TABLE" | "DOMAIN" | "SEQUENCE";
  /** Qualified when outside `public`. */
  name: string;
};

/** What within the subject a step changes; absent when the step is about the subject itself. */
export type OperationTarget = {
  kind: "COLUMN" | "INDEX" | "CONSTRAINT" | "IDENTITY" | "DEFAULT" | "OPTIONS";
  name: string;
};

/** One attribute a step changes, as the definition and the database have it. */
export type AttributeChange = { attribute: string; from: unknown; to: unknown };

/**
 * What an operation does, for reporting. A **change** — one logical difference on one target —
 * becomes one or more **steps**, each one operation: one statement, one transaction.
 */
export type OperationSummary = {
  /** Identifies the change: every step of it shares this key. */
  change: string;
  /** This step's position in its change, from 1. */
  step: number;
  steps: number;
  subject: OperationSubject;
  action: OperationAction;
  target?: OperationTarget;
  changes: AttributeChange[];
  risk: OperationRisk;
  /** Runs as an async job (`CREATE INDEX ASYNC`, `ALTER TABLE ASYNC … VALIDATE`). */
  async: boolean;
  note?: string;
};

export type DDLOperation = {
  type: DDLOperationType;
  object: SerializedObject<DefinitionNode>;
  statement: DDLStatement;
  references?: string[];
  summary: OperationSummary;
};

/** An operation before it is placed in its change: the change fills in the step numbering. */
export type DraftOperation = Omit<DDLOperation, "summary"> & {
  summary: Omit<OperationSummary, "change" | "step" | "steps" | "changes" | "async"> &
    Partial<Pick<OperationSummary, "changes" | "async">>;
};

/** The steps of one change, numbered in the order given — the order they must run in. */
export function change(key: string, drafts: DraftOperation[]): DDLOperation[] {
  return drafts.map((draft, index) => ({
    ...draft,
    summary: {
      changes: [],
      async: false,
      ...draft.summary,
      change: key,
      step: index + 1,
      steps: drafts.length,
    },
  }));
}

export type IndexedDDLOperation = {
  id: number;
} & DDLOperation;

export type RefusalCode =
  | "IMMUTABLE_CONSTRAINT"
  | "KIND_MISMATCH"
  | "NO_ALTER_DOMAIN_CONSTRAINT"
  | "NO_ALTER_DOMAIN_TYPE"
  | "NO_ADD_GENERATED_COLUMN"
  | "NO_ADD_IDENTITY"
  | "NO_ALTER_GENERATED"
  | "NO_ALTER_PRIMARY_KEY_COLUMN"
  | "NO_DROP_PRIMARY_KEY_COLUMN"
  | "NOT_NULL_NEEDS_DEFAULT"
  | "RENAME_CONFLICT";

/** What a refused change would have done, for reporting. */
export type RefusalSummary = {
  subject: OperationSubject;
  action: OperationAction;
  target?: OperationTarget;
  changes: AttributeChange[];
};

export type DDLOperationError<T extends DefinitionNode = DefinitionNode> = {
  code: RefusalCode | string;
  message: string;
  object: SerializedObject<T>;
  subject?: string;
  diffs?: AnyDiff<T>[];
  summary?: RefusalSummary;
};

export function refusal<T extends DefinitionNode>(args: {
  code: RefusalCode;
  message: string;
  object: SerializedObject<T>;
  subject?: string;
  diffs?: AnyDiff<T>[];
  summary?: RefusalSummary;
}): DDLOperationError<T> {
  return args;
}

/** The attribute changes a set of diffs describes, for a summary. */
export function attributeChanges(diffs: AnyDiff[]): AttributeChange[] {
  return diffs.flatMap((diff) =>
    diff.key === undefined
      ? []
      : [{ attribute: String(diff.key), from: diff.prevValue ?? null, to: diff.value ?? null }]
  );
}

export type OperationResult = {
  operations: DDLOperation[];
  errors: DDLOperationError[];
};

export function hasCustomNamespace(
  obj: SerializedObject<DefinitionNode>
): obj is SerializedObject<DefinitionNode> & { namespace: string } {
  return "namespace" in obj && !!obj.namespace && obj.namespace !== "public";
}

/**
 * The schema to qualify an object's statements with: its namespace outside `public`, nothing in
 * it. Every statement that names a table, index, sequence or domain goes through this, so none
 * depends on `search_path`.
 */
export function schemaOf(obj: SerializedObject<DefinitionNode>): string | undefined {
  return hasCustomNamespace(obj) ? obj.namespace : undefined;
}

/** PostgreSQL's identifier limit, in bytes; a longer name is silently truncated to it. */
const MAX_IDENTIFIER_BYTES = 63;
const utf8 = new TextEncoder();

/** FNV-1a, 32-bit: a stable, dependency-free fingerprint for a name too long to keep whole. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A name the planner derives from another (`<base>_<suffix>`), kept within 63 bytes. The server
 * would truncate a longer one silently, and the next plan would no longer recognise what it
 * built. Past the limit, `base` is cut on a character boundary and a fingerprint of the full name
 * keeps the result unique: `<base prefix>_<fingerprint>_<suffix>`. The same input always derives
 * the same name, so the planner finds it again.
 */
export function deriveIdentifier(base: string, suffix: string): string {
  const full = `${base}_${suffix}`;
  if (utf8.encode(full).length <= MAX_IDENTIFIER_BYTES) return full;

  const tail = `_${fingerprint(full)}_${suffix}`;
  const budget = MAX_IDENTIFIER_BYTES - utf8.encode(tail).length;
  let prefix = "";

  for (const char of base) {
    if (utf8.encode(prefix + char).length > budget) break;
    prefix += char;
  }

  return prefix + tail;
}

export function qualifiedName(obj: SerializedObject<DefinitionNode>): string {
  return hasCustomNamespace(obj) ? `${obj.namespace}.${obj.name}` : obj.name;
}

export function qualifiedConstraintName(
  parentTableQualifiedName: string,
  constraint: SerializedObject<DefinitionNode>
): string {
  return `${parentTableQualifiedName}.${constraint.name}`;
}

export function maybeNamespaceReference(
  obj: SerializedObject<DefinitionNode>
): [string] | undefined {
  return hasCustomNamespace(obj) ? [obj.namespace] : undefined;
}

export function kindMismatchError(
  expectedKind: OperationSubject["kind"],
  foundObject: SerializedObject<DefinitionNode>
): DDLOperationError {
  return {
    code: "KIND_MISMATCH",
    message: `Expected object of kind ${expectedKind}, but found ${foundObject.kind}`,
    object: foundObject,
    summary: {
      subject: { kind: expectedKind, name: qualifiedName(foundObject) },
      action: "ALTER",
      changes: [{ attribute: "kind", from: foundObject.kind, to: expectedKind }],
    },
  };
}
