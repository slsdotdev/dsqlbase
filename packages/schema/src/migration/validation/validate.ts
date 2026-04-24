import { SerializedSchema } from "../base.js";
import { ValidationContext, ValidationResult, ValidationRules } from "./context.js";
import { noDuplicateObjectNames } from "./rules/global.js";

export const globalRules = Object.freeze([noDuplicateObjectNames] as const);

/**
 * Validates a serialized schema definition against the expected structure and constraints.
 *
 * This function checks for the presence of required fields, correct data types, and adherence to any specified rules.
 *
 * @param definition Serialized schema definition
 */

export function validateDefinition<T extends SerializedSchema>(
  definition: T,
  rules: ValidationRules = {}
): ValidationResult {
  const context = new ValidationContext(definition);

  for (const rule of globalRules) {
    rule(definition, context);
  }

  for (const node of definition) {
    const nodeRules = rules[node.kind] ?? [];

    for (const rule of nodeRules) {
      rule(node, context);
    }
  }

  return context.getResults();
}
