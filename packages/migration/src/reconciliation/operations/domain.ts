import { AnyDomainDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  DDLOperation,
  DDLOperationError,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
  refusal,
} from "./base.js";
import { ddl } from "../../ddl/index.js";
import { diffDomain } from "../diffs/domain.js";
import { AnyDiff } from "../diffs/base.js";

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
  options: DDLOperationOptions
): DDLOperation {
  const statement = ddl.dropDomain({
    name: object.name,
    ifExists: options.safeOperations,
    cascade: options.safeOperations ? "CASCADE" : "RESTRICT",
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
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  if (!remote) {
    return {
      operations: [createDomainOperation(local, options.safeOperations)],
      errors: [],
    };
  }

  if (remote.kind !== "DOMAIN") {
    return {
      operations: [],
      errors: [kindMismatchError("DOMAIN", remote)],
    };
  }

  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  const namespaceRef = maybeNamespaceReference(local);
  const diffs = diffDomain(local, remote);
  const blocked: AnyDiff<AnyDomainDefinition>[] = [];
  const blockedAttrs: string[] = [];

  for (const diff of diffs) {
    const key = diff.key as string;

    if (key === "defaultValue") {
      const action =
        diff.type === "remove"
          ? ddl.dropDefault()
          : ddl.setDefault({ expression: String(diff.value) });

      operations.push({
        type: "ALTER",
        object: local,
        statement: ddl.alterDomain({
          name: local.name,
          schema: local.namespace,
          action,
        }),
        references: namespaceRef,
      });
      continue;
    }

    blocked.push(diff);
    blockedAttrs.push(key);
  }

  if (blocked.length > 0) {
    errors.push(
      refusal({
        code: "IMMUTABLE_DOMAIN",
        message:
          `Domain "${local.name}" is immutable except for defaultValue — ` +
          `cannot change ${blockedAttrs.join(", ")}.`,
        object: local,
        subject: local.name,
        diffs: blocked,
      })
    );
  }

  return { operations, errors };
}
