import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
} from "./base.js";
import { ddl } from "../../ddl/index.js";

export function createSequenceOperation(
  object: SerializedObject<AnySequenceDefinition>,
  ifNotExists = true
): DDLOperation {
  const statement = ddl.createSequence({
    name: object.name,
    schema: object.namespace,
    ifNotExists,
    options: ddl.sequenceOptions({
      dataType: object.dataType,
      incrementBy: object.increment,
      cache: object.cache,
      cycle: object.cycle,
      startValue: object.startValue,
      minValue: object.minValue,
      maxValue: object.maxValue,
      ownedBy: object.ownedBy,
    }),
  });

  return {
    type: "CREATE",
    object: object,
    statement: statement,
    references: maybeNamespaceReference(object),
  };
}

export function dropSequenceOperation(
  object: SerializedObject<AnySequenceDefinition>,
  ifExists = true
): DDLOperation {
  const statement = ddl.dropSequence({
    name: object.name,
    ifExists,
    cascade: "CASCADE",
  });

  return {
    type: "DROP",
    object: object,
    statement: statement,
    references: maybeNamespaceReference(object),
  };
}

export function diffSequenceOperations(
  local: SerializedObject<AnySequenceDefinition>,
  remote?: SerializedObject<SchemaObjectType>
): OperationResult {
  if (!remote) {
    return {
      operations: [createSequenceOperation(local)],
      errors: [],
    };
  }

  if (remote.kind !== "SEQUENCE") {
    return {
      operations: [],
      errors: [kindMismatchError("SEQUENCE", remote)],
    };
  }

  return { operations: [], errors: [] };
}
