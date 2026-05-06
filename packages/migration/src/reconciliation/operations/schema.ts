import { AnyNamespaceDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  kindMismatchError,
  OperationResult,
} from "./base.js";
import { ddl } from "../../ddl/index.js";

export function createSchemaOperation(
  object: SerializedObject<AnyNamespaceDefinition>,
  ifNotExists = true
): DDLOperation {
  const statement = ddl.createSchema({
    name: object.name,
    ifNotExists,
  });

  return {
    type: "CREATE",
    object,
    statement,
  };
}

export function dropSchemaOperation(
  object: SerializedObject<AnyNamespaceDefinition>,
  options: DDLOperationOptions
): DDLOperation {
  const statement = ddl.dropSchema({
    name: object.name,
    ifExists: options.safeOperations,
    cascade: options.safeOperations ? "CASCADE" : "RESTRICT",
  });

  return {
    type: "DROP",
    object,
    statement,
  };
}

export function diffSchemaOperations(
  local: SerializedObject<AnyNamespaceDefinition>,
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  if (!remote) {
    return {
      operations: [createSchemaOperation(local, options.safeOperations)],
      errors: [],
    };
  }

  if (remote.kind !== "SCHEMA") {
    return {
      operations: [],
      errors: [kindMismatchError("SCHEMA", remote)],
    };
  }

  return { operations: [], errors: [] };
}
