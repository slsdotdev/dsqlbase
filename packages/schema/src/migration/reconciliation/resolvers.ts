import { AnyTableDefinition, DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../base.js";
import { TableDiffType } from "./diffs.js";
import { DDLStatement } from "../ddl/ast.js";

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

export function qualifiedName(obj: SerializedObject<DefinitionNode>): string {
  return "namespace" in obj && obj.namespace ? `${obj.namespace}.${obj.name}` : obj.name;
}

export function resolveTableDiff(
  object: SerializedObject<AnyTableDefinition>,
  diff: TableDiffType
): { operations: DDLOperation[]; errors: DDLOperationError[] } {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  console.log(`Resolving diff for table ${qualifiedName(object)}:`, diff);

  return { operations, errors };
}
