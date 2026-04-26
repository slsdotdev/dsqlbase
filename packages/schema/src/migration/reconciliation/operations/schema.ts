import { AnyNamespaceDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import { DDLOperation, kindMismatchError, OperationResult } from "./base.js";
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
  ifExists = true,
  cascade: "CASCADE" | "RESTRICT" = "CASCADE"
): DDLOperation {
  const statement = ddl.dropSchema({
    name: object.name,
    ifExists,
    cascade,
  });

  return {
    type: "DROP",
    object,
    statement,
  };
}

export function diffSchemaOperations(
  local: SerializedObject<AnyNamespaceDefinition>,
  remote?: SerializedObject<SchemaObjectType>
): OperationResult {
  if (!remote) {
    return {
      operations: [createSchemaOperation(local)],
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
