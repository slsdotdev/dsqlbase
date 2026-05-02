import { SchemaObjectType, SerializedObject } from "../../base.js";
import { DDLOperation, OperationResult } from "./base.js";
import { diffDomainOperations, dropDomainOperation } from "./domain.js";
import { diffSchemaOperations, dropSchemaOperation } from "./schema.js";
import { diffSequenceOperations, dropSequenceOperation } from "./sequence.js";
import { diffTableOperations, dropTableOperation } from "./table.js";

export function diffObjectOperations(
  local: SerializedObject<SchemaObjectType>,
  remote?: SerializedObject<SchemaObjectType>
): OperationResult {
  switch (local.kind) {
    case "SCHEMA":
      return diffSchemaOperations(local, remote);
    case "TABLE":
      return diffTableOperations(local, remote);
    case "DOMAIN":
      return diffDomainOperations(local, remote);
    case "SEQUENCE":
      return diffSequenceOperations(local, remote);
    default:
      throw new Error(`Diff operation not implemented for object kind ${local["kind"]}`);
  }
}

export function dropObjectOperations(object: SerializedObject<SchemaObjectType>): DDLOperation {
  switch (object.kind) {
    case "SCHEMA":
      return dropSchemaOperation(object);
    case "TABLE":
      return dropTableOperation(object);
    case "DOMAIN":
      return dropDomainOperation(object);
    case "SEQUENCE":
      return dropSequenceOperation(object);
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
  hasCustomNamespace,
  refusal,
  type DDLOperation,
  type IndexedDDLOperation,
  type DDLOperationError,
  type OperationResult,
  type DDLOperationType,
  type RefusalCode,
} from "./base.js";
