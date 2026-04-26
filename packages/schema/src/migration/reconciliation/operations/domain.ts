import { AnyDomainDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
} from "./base.js";
import { ddl } from "../../ddl/index.js";

export function createDomainOperation(
  object: SerializedObject<AnyDomainDefinition>,
  ifNotExists = true
): DDLOperation {
  const statement = ddl.createDomain({
    name: object.name,
    schema: object.namespace,
    dataType: object.dataType,
    notNull: object.notNull,
    defaultValue: object.defaultValue,
    check: object.check
      ? ddl.check({ name: object.check.name, expression: object.check.expression })
      : undefined,
    ifNotExists,
  });

  return {
    type: "CREATE",
    object,
    statement,
    references: maybeNamespaceReference(object),
  };
}

export function dropDomainOperation(
  object: SerializedObject<AnyDomainDefinition>,
  ifExists = true
): DDLOperation {
  const statement = ddl.dropDomain({
    name: object.name,
    ifExists,
    cascade: "CASCADE",
  });

  return {
    type: "DROP",
    object,
    statement,
    references: maybeNamespaceReference(object),
  };
}

export function diffDomainOperations(
  local: SerializedObject<AnyDomainDefinition>,
  remote?: SerializedObject<SchemaObjectType>
): OperationResult {
  if (!remote) {
    return {
      operations: [createDomainOperation(local)],
      errors: [],
    };
  }

  if (remote.kind !== "DOMAIN") {
    return {
      operations: [],
      errors: [kindMismatchError("DOMAIN", remote)],
    };
  }

  return { operations: [], errors: [] };
}
