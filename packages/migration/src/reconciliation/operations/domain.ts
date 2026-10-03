import { AnyDomainDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  attributeChanges,
  change,
  DDLOperation,
  DDLOperationError,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
  OperationSubject,
  qualifiedName,
  refusal,
} from "./base.js";
import { ddl } from "../../ddl/index.js";
import { diffDomain } from "../diffs/domain.js";
import { AnyDiff } from "../diffs/base.js";

const subjectOf = (object: SerializedObject<AnyDomainDefinition>): OperationSubject => ({
  kind: "DOMAIN",
  name: qualifiedName(object),
});

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

  const [operation] = change(qualifiedName(object), [
    {
      type: "CREATE",
      object,
      statement,
      references: maybeNamespaceReference(object),
      summary: { subject: subjectOf(object), action: "CREATE", risk: "safe" },
    },
  ]);
  return operation;
}

export function dropDomainOperation(
  object: SerializedObject<AnyDomainDefinition>,
  options: DDLOperationOptions
): DDLOperation {
  const statement = ddl.dropDomain({
    name: object.name,
    ifExists: options.ifExists,
    cascade: "RESTRICT",
  });

  const [operation] = change(qualifiedName(object), [
    {
      type: "DROP",
      object,
      statement,
      references: maybeNamespaceReference(object),
      summary: { subject: subjectOf(object), action: "DROP", risk: "destructive" },
    },
  ]);
  return operation;
}

export function diffDomainOperations(
  local: SerializedObject<AnyDomainDefinition>,
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  if (!remote) {
    return {
      operations: [createDomainOperation(local, options.ifExists)],
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
    if (diff.key === "defaultValue") {
      const drop = diff.type === "remove";

      operations.push(
        ...change(`${qualifiedName(local)}.default`, [
          {
            type: "ALTER",
            object: local,
            statement: ddl.alterDomain({
              name: local.name,
              schema: local.namespace,
              action: drop ? ddl.dropDefault() : ddl.setDefault({ expression: String(diff.value) }),
            }),
            references: namespaceRef,
            summary: {
              subject: subjectOf(local),
              action: drop ? "DROP" : "ALTER",
              target: { kind: "DEFAULT", name: local.name },
              changes: attributeChanges([diff as AnyDiff]),
              risk: drop ? "lossy" : "safe",
            },
          },
        ])
      );
      continue;
    }

    blocked.push(diff);

    if (diff.key) {
      blockedAttrs.push(diff.key);
    }
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
        summary: {
          subject: subjectOf(local),
          action: "ALTER",
          changes: attributeChanges(blocked as AnyDiff[]),
        },
      })
    );
  }

  return { operations, errors };
}
