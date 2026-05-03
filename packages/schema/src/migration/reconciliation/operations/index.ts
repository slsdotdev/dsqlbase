import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  OperationResult,
} from "./base.js";
import { diffDomainOperations, dropDomainOperation } from "./domain.js";
import { diffSchemaOperations, dropSchemaOperation } from "./schema.js";
import { diffSequenceOperations, dropSequenceOperation } from "./sequence.js";
import { diffTableOperations, dropTableOperation } from "./table.js";

export function diffObjectOperations(
  local: SerializedObject<SchemaObjectType>,
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  switch (local.kind) {
    case "SCHEMA":
      return diffSchemaOperations(local, remote, options);
    case "TABLE":
      return diffTableOperations(local, remote, options);
    case "DOMAIN":
      return diffDomainOperations(local, remote, options);
    case "SEQUENCE":
      return diffSequenceOperations(local, remote, options);
    default:
      throw new Error(`Diff operation not implemented for object kind ${local["kind"]}`);
  }
}

export function dropObjectOperations(
  object: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  switch (object.kind) {
    case "SCHEMA":
      return dropSchemaOperation(object, options);
    case "TABLE":
      return dropTableOperation(object, options);
    case "DOMAIN":
      return dropDomainOperation(object, options);
    case "SEQUENCE":
      return dropSequenceOperation(object, options);
    default:
      throw new Error(
        `Unreachable. Diff operation not implemented for object kind ${object["kind"]}`
      );
  }
}

export {
  kindMismatchError,
  maybeNamespaceReference,
  qualifiedName,
  qualifiedConstraintName,
  hasCustomNamespace,
  refusal,
  type DDLOperation,
  type IndexedDDLOperation,
  type DDLOperationError,
  type OperationResult,
  type DDLOperationType,
  type RefusalCode,
} from "./base.js";
