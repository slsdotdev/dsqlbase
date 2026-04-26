import { DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { DDLStatement } from "../../ddl/index.js";

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

export interface DDLOperationError {
  code: string;
  message: string;
  object: SerializedObject<DefinitionNode>;
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
