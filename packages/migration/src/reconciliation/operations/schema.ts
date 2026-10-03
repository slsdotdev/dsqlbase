import { AnyNamespaceDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  change,
  kindMismatchError,
  OperationResult,
  OperationSubject,
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

  const [operation] = change(object.name, [
    {
      type: "CREATE",
      object,
      statement,
      summary: { subject: subjectOf(object), action: "CREATE", risk: "safe" },
    },
  ]);
  return operation;
}

const subjectOf = (object: SerializedObject<AnyNamespaceDefinition>): OperationSubject => ({
  kind: "SCHEMA",
  name: object.name,
});

export function dropSchemaOperation(
  object: SerializedObject<AnyNamespaceDefinition>,
  options: DDLOperationOptions
): DDLOperation {
  const statement = ddl.dropSchema({
    name: object.name,
    ifExists: options.safeOperations,
    cascade: "RESTRICT",
  });

  const [operation] = change(object.name, [
    {
      type: "DROP",
      object,
      statement,
      summary: { subject: subjectOf(object), action: "DROP", risk: "destructive" },
    },
  ]);
  return operation;
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
