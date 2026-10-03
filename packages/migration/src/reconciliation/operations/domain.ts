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
  DraftOperation,
  OperationSubject,
  OperationTarget,
  qualifiedName,
  refusal,
  RefusalCode,
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
  const subject = subjectOf(local);
  const domainName = qualifiedName(local);

  const alter = (
    key: string,
    action: Parameters<typeof ddl.alterDomain>[0]["action"],
    summary: Omit<DraftOperation["summary"], "subject">
  ) =>
    operations.push(
      ...change(`${domainName}.${key}`, [
        {
          type: "ALTER",
          object: local,
          statement: ddl.alterDomain({ name: local.name, schema: local.namespace, action }),
          references: namespaceRef,
          summary: { subject, ...summary },
        },
      ])
    );

  const refuse = (code: RefusalCode, message: string, diffs: AnyDiff[], target?: OperationTarget) =>
    errors.push(
      refusal({
        code,
        message,
        object: local,
        subject: local.name,
        diffs: diffs as AnyDiff<AnyDomainDefinition>[],
        summary: {
          subject,
          action: target?.kind === "CONSTRAINT" ? "ADD" : "ALTER",
          target,
          changes: attributeChanges(diffs),
        },
      })
    );

  const newDomain =
    `Define a new domain instead and move the columns to it — a type change for each, which ` +
    `drops and re-adds them unless their data is migrated first.`;

  for (const diff of diffDomain(local, remote) as AnyDiff[]) {
    switch (String(diff.key)) {
      case "defaultValue": {
        const drop = diff.type === "remove";
        alter(
          "default",
          drop ? ddl.dropDefault() : ddl.setDefault({ expression: String(diff.value) }),
          {
            action: drop ? "DROP" : "ALTER",
            target: { kind: "DEFAULT", name: local.name },
            changes: attributeChanges([diff]),
            risk: drop ? "lossy" : "safe",
          }
        );
        break;
      }

      case "dataType":
        refuse(
          "NO_ALTER_DOMAIN_TYPE",
          `Domain "${local.name}" can't change from ${String(diff.prevValue)} to ${String(diff.value)}: ` +
            `PostgreSQL has no ALTER DOMAIN … TYPE. ${newDomain}`,
          [diff]
        );
        break;

      case "notNull":
        if (local.notNull) {
          refuse(
            "NO_ALTER_DOMAIN_CONSTRAINT",
            `Domain "${local.name}" can't become NOT NULL: DSQL has no ALTER DOMAIN … SET NOT NULL. ${newDomain}`,
            [diff],
            { kind: "CONSTRAINT", name: "NOT NULL" }
          );
        } else {
          alter("notNull", ddl.dropNotNull(), {
            action: "DROP",
            target: { kind: "CONSTRAINT", name: "NOT NULL" },
            changes: attributeChanges([diff]),
            risk: "destructive",
            note: "DSQL can't make a domain NOT NULL again",
          });
        }
        break;

      case "check": {
        const value = diff.value as { name: string } | null | undefined;
        const prev = diff.prevValue as { name: string } | null | undefined;

        if (value) {
          refuse(
            "NO_ALTER_DOMAIN_CONSTRAINT",
            `Domain "${local.name}" can't ${prev ? `replace CHECK "${prev.name}" with` : "add"} CHECK ` +
              `"${value.name}": DSQL has no ALTER DOMAIN … ADD CONSTRAINT. ${newDomain}`,
            [diff],
            { kind: "CONSTRAINT", name: value.name }
          );
        } else if (prev) {
          alter(
            `check`,
            ddl.dropConstraint({
              name: prev.name,
              ifExists: options.ifExists,
              cascade: "RESTRICT",
            }),
            {
              action: "DROP",
              target: { kind: "CONSTRAINT", name: prev.name },
              changes: attributeChanges([diff]),
              risk: "destructive",
              note: "DSQL can't add a CHECK to an existing domain again",
            }
          );
        }
        break;
      }
    }
  }

  return { operations, errors };
}
