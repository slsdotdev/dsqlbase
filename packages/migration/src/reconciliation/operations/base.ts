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
   * Adds IF NOT EXISTS / IF EXISTS modifiers to operations where applicable.
   * @default false
   */
  safeOperations: boolean;
};

export const DEFAULT_DDL_OPERATION_OPTIONS: DDLOperationOptions = {
  asyncIndexes: true,
  safeOperations: false,
};

export type DDLOperationType = "CREATE" | "DROP" | "ALTER";

/**
 * What an operation risks, by whether redeploying the previous definition undoes it:
 * - `safe` — adds or relaxes; the previous definition can be restored.
 * - `lossy` — removes something redeploying restores (a default, an index, a constraint); no row
 *   data is lost, but behaviour or performance is degraded until then.
 * - `destructive` — cannot be undone by redeploying: row data is lost, or DSQL cannot re-create
 *   what was removed.
 */
export type OperationRisk = "safe" | "lossy" | "destructive";

export const RISK_ORDER: readonly OperationRisk[] = ["safe", "lossy", "destructive"];

/** The higher of two risks. */
export const maxRisk = (a: OperationRisk, b: OperationRisk): OperationRisk =>
  RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;

export type OperationAction = "CREATE" | "ADD" | "ALTER" | "DROP" | "RENAME" | "VALIDATE";

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
  | "IMMUTABLE_COLUMN"
  | "NO_DROP_COLUMN"
  | "IMMUTABLE_CONSTRAINT"
  | "IMMUTABLE_DOMAIN"
  | "IMMUTABLE_INDEX"
  | "NO_FOREIGN_KEY"
  | "KIND_MISMATCH";

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
