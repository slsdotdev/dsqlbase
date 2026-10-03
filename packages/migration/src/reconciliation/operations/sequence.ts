import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  change,
  DDLOperation,
  DDLOperationError,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
  OperationRisk,
  OperationSubject,
  qualifiedName,
  schemaOf,
} from "./base.js";
import { ddl } from "../../ddl/index.js";
import { changedSequenceOptions, effectiveSequenceOptions } from "../diffs/sequence.js";

const subjectOf = (object: SerializedObject<AnySequenceDefinition>): OperationSubject => ({
  kind: "SEQUENCE",
  name: qualifiedName(object),
});

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

export function dropSequenceOperation(
  object: SerializedObject<AnySequenceDefinition>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  const statement = ddl.dropSequence({
    name: object.name,
    schema: schemaOf(object),
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

export function diffSequenceOperations(
  local: SerializedObject<AnySequenceDefinition>,
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  if (!remote) {
    operations.push(createSequenceOperation(local, options.ifExists));
    return { operations, errors };
  }

  if (remote.kind !== "SEQUENCE") {
    errors.push(kindMismatchError("SEQUENCE", remote));
    return { operations, errors };
  }

  const changed = changedSequenceOptions(local.options, remote.options);

  if (changed.length === 0) {
    return { operations, errors };
  }

  // Only what changed: an unchanged option restated is noise in the plan, and an unset one
  // would print its default.
  const effective = effectiveSequenceOptions(local.options);
  const previous = effectiveSequenceOptions(remote.options);
  // Narrower bounds can make `nextval` fail: lossy. Any other option change is safe.
  const risk: OperationRisk =
    effective.maxValue < previous.maxValue || effective.minValue > previous.minValue
      ? "lossy"
      : "safe";
  const pick = <K extends (typeof changed)[number]>(key: K) =>
    changed.includes(key) ? effective[key] : undefined;

  operations.push(
    ...change(qualifiedName(local), [
      {
        type: "ALTER",
        object: local,
        statement: ddl.alterSequence({
          name: local.name,
          schema: local.namespace,
          options: ddl.sequenceOptions({
            dataType: pick("dataType"),
            incrementBy: pick("increment"),
            minValue: pick("minValue"),
            maxValue: pick("maxValue"),
            startValue: pick("startValue"),
            cache: pick("cache"),
            cycle: pick("cycle"),
          }),
        }),
        references: maybeNamespaceReference(local),
        summary: {
          subject: subjectOf(local),
          action: "ALTER",
          target: { kind: "OPTIONS", name: local.name },
          changes: changed.map((key) => ({
            attribute: key,
            from: previous[key],
            to: effective[key],
          })),
          risk,
        },
      },
    ])
  );

  return { operations, errors };
}
