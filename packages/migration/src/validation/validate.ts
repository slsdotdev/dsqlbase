import { DefinitionNode } from "@dsqlbase/core";
import { SerializedSchema } from "../base.js";
import { Rule, ValidationContext, ValidationResult, ValidationRules } from "./context.js";
import { identifierTooLong, noDuplicateObjectNames } from "./rules/global.js";
import { reservedNamespace } from "./rules/schema.js";
import { invalidSequenceCache } from "./rules/sequence.js";
import {
  duplicateIndexCoverage,
  emptyConstraintColumns,
  redundantUniqueOnPk,
  tableIdentifiersTooLong,
  tableNoPrimaryKey,
  unknownColumnReference,
  varcharWithoutLength,
} from "./rules/table.js";

export const globalRules = Object.freeze([noDuplicateObjectNames] as const);

export const defaultRules: ValidationRules = Object.freeze({
  SCHEMA: [reservedNamespace],
  DOMAIN: [identifierTooLong],
  TABLE: [
    tableNoPrimaryKey,
    unknownColumnReference,
    emptyConstraintColumns,
    identifierTooLong,
    tableIdentifiersTooLong,
    redundantUniqueOnPk,
    duplicateIndexCoverage,
    varcharWithoutLength,
  ],
  SEQUENCE: [identifierTooLong, invalidSequenceCache],
} as const);

/**
 * Validates a serialized schema definition against the expected structure and constraints.
 *
 * This function checks for the presence of required fields, correct data types, and adherence to any specified rules.
 *
 * @param definition Serialized schema definition
 */

export function validateDefinition<T extends SerializedSchema>(
  definition: T,
  rules: ValidationRules = defaultRules
): ValidationResult {
  const context = new ValidationContext(definition);

  for (const rule of globalRules) {
    rule(definition, context);
  }

  for (const node of definition) {
    const nodeRules: Rule<DefinitionNode>[] = rules[node.kind] ?? [];

    for (const rule of nodeRules) {
      rule(node, context);
    }
  }

  return context.getResults();
}
