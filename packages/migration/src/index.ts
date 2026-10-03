export {
  ORDERED_SCHEMA_OBJECTS,
  getSerializedSchemaObjects,
  isDefinitionObject,
  isDefinitionInstance,
  isSchemaObjectKind,
  MigrationError,
  sortSchemaObjects,
  type MigrationErrorOptions,
  type MigrationIssue,
  type SchemaObjectType,
  type SerializedObject,
  type SerializedSchema,
} from "./base.js";
export {
  createPrinter,
  printSchemaForCreate,
  ddl,
  STATEMENT_BREAKPOINT,
  type PrintSchemaOptions,
} from "./ddl/index.js";
export { introspect, type IntrospectionResult } from "./introspection/introspect.js";
export { SchemaReconciler, reconcileSchemas } from "./reconciliation/reconcile.js";
export {
  validateDefinition,
  type Rule,
  type ValidationContext,
  type ValidationIssue,
  type ValidationResult,
  type ValidationRules,
} from "./validation/index.js";
export {
  MigrationRunner,
  createMigrationRunner,
  type AllowedRisks,
  type MigrationRunnerOptions,
  type PlanResult,
  type RunResult,
} from "./runner.js";
export {
  formatPlan,
  type ExecutedPlanRow,
  type FormatPlanOptions,
  type PlanRow,
} from "./report.js";
export type {
  AttributeChange,
  OperationAction,
  OperationRisk,
  OperationSubject,
  OperationSummary,
  OperationTarget,
} from "./reconciliation/operations/index.js";
