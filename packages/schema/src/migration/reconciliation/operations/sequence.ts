import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  DDLOperationError,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
} from "./base.js";
import { ddl } from "../../ddl/index.js";
import { diffSequence } from "../diffs/sequence.js";

export function createSequenceOperation(
  object: SerializedObject<AnySequenceDefinition>,
  ifNotExists = true
): DDLOperation {
  const statement = ddl.createSequence({
    name: object.name,
    schema: object.namespace,
    ifNotExists,
    options: ddl.sequenceOptions({
      dataType: object.options.dataType,
      incrementBy: object.options.increment,
      cache: object.options.cache,
      cycle: object.options.cycle,
      startValue: object.options.startValue,
      minValue: object.options.minValue,
      maxValue: object.options.maxValue,
      ownedBy: object.options.ownedBy,
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
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  const statement = ddl.dropSequence({
    name: object.name,
    ifExists: options.safeOperations,
    cascade: options.safeOperations ? "CASCADE" : "RESTRICT",
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
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  if (!remote) {
    operations.push(createSequenceOperation(local, options.safeOperations));
    return { operations, errors };
  }

  if (remote.kind !== "SEQUENCE") {
    errors.push(kindMismatchError("SEQUENCE", remote));
    return { operations, errors };
  }

  if (diffSequence(local, remote).length === 0) {
    return { operations, errors };
  }

  operations.push({
    type: "ALTER",
    object: local,
    statement: ddl.alterSequence({
      name: local.name,
      schema: local.namespace,
      options: ddl.sequenceOptions({
        dataType: local.options.dataType,
        incrementBy: local.options.increment,
        cache: local.options.cache,
        cycle: local.options.cycle,
        startValue: local.options.startValue,
        minValue: local.options.minValue,
        maxValue: local.options.maxValue,
        ownedBy: local.options.ownedBy,
      }),
    }),
    references: maybeNamespaceReference(local),
  });

  return { operations, errors };
}
