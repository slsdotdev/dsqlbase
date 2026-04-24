import { SchemaObjectType, SerializedObject, SerializedSchema } from "../base.js";

export interface ValidationIssue {
  level: "error" | "warning" | "notice";
  code: string;
  path: string[];
  message: string;
  hint?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export class ValidationContext {
  readonly objects: Map<string, SerializedObject<SchemaObjectType>>;
  readonly namespaces: Set<string>;

  readonly issues: ValidationIssue[] = [];

  constructor(definition: SerializedSchema) {
    this.objects = new Map(definition.map((obj) => [obj.name, obj]));
    this.namespaces = new Set(
      definition
        .filter((obj) => obj.kind === "SCHEMA")
        .map((schema) => schema.name)
        .concat("public")
    );
  }

  public report(issue: ValidationIssue) {
    this.issues.push(issue);
  }

  getResults(): ValidationResult {
    const errors = this.issues.filter((issue) => issue.level === "error");
    const warnings = this.issues.filter((issue) => issue.level === "warning");

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export type Rule<T extends SchemaObjectType["name"]> = (
  definition: SerializedObject<Extract<SchemaObjectType, { name: T }>>,
  context: ValidationContext
) => void;

export type GlobalRule = (definition: SerializedSchema, context: ValidationContext) => void;

export type ValidationRules = {
  [K in SchemaObjectType["name"]]?: Rule<K>[];
};
