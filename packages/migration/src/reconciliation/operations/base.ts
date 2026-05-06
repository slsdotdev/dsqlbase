import { DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { DDLStatement } from "../../ddl/index.js";
import { AnyDiff } from "../diffs/base.js";

export interface DDLOperationOptions {
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
}

export const DEFAULT_DDL_OPERATION_OPTIONS: DDLOperationOptions = {
  asyncIndexes: true,
  safeOperations: false,
};

export type DDLOperationType = "CREATE" | "DROP" | "ALTER";

export interface DDLOperation {
  type: DDLOperationType;
  object: SerializedObject<DefinitionNode>;
  statement: DDLStatement;
  references?: string[];
}

export interface IndexedDDLOperation extends DDLOperation {
  id: number;
}

export type RefusalCode =
  | "IMMUTABLE_COLUMN"
  | "NO_DROP_COLUMN"
  | "IMMUTABLE_CONSTRAINT"
  | "IMMUTABLE_DOMAIN"
  | "IMMUTABLE_INDEX"
  | "NO_FOREIGN_KEY"
  | "KIND_MISMATCH";

export interface DDLOperationError<T extends DefinitionNode = DefinitionNode> {
  code: RefusalCode | string;
  message: string;
  object: SerializedObject<T>;
  subject?: string;
  diffs?: AnyDiff<T>[];
}

export function refusal<T extends DefinitionNode>(args: {
  code: RefusalCode;
  message: string;
  object: SerializedObject<T>;
  subject?: string;
  diffs?: AnyDiff<T>[];
}): DDLOperationError<T> {
  return args;
}

export interface OperationResult {
  operations: DDLOperation[];
  errors: DDLOperationError[];
}

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
  expectedKind: string,
  foundObject: SerializedObject<DefinitionNode>
): DDLOperationError {
  return {
    code: "KIND_MISMATCH",
    message: `Expected object of kind ${expectedKind}, but found ${foundObject.kind}`,
    object: foundObject,
  };
}
