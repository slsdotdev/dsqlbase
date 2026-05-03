import { Session } from "@dsqlbase/core";
import { MigrationError, SerializedSchema } from "./base.js";
import { createPrinter } from "./ddl/printer.js";
import { introspect as introspectSchema } from "./introspection/introspect.js";
import { DDLOperationError, IndexedDDLOperation } from "./reconciliation/operations/index.js";
import { reconcileSchemas } from "./reconciliation/reconcile.js";
import { ValidationResult } from "./validation/index.js";
import { validateDefinition } from "./validation/validate.js";
import { OperationExecutionResult, OperationExecutor } from "./executor.js";
import { DDLOperationOptions } from "./reconciliation/operations/base.js";

export interface MigrationRunnerOptions extends Partial<DDLOperationOptions> {
  /**
   * If true, will destroy objects that don't match the local definition.
   *
   * **⚠️ Warning:** can cause data loss.
   *
   * @default false
   */
  destructive?: boolean;
}

export interface PlanResult {
  operations: IndexedDDLOperation[];
  errors: DDLOperationError[];
  destructive: boolean;
}

export class MigrationRunner {
  private readonly _session: Session;
  private readonly _print = createPrinter();
  private readonly _executor: OperationExecutor;

  constructor(session: Session) {
    this._session = session;
    this._executor = new OperationExecutor(session);
  }

  public validate(definition: SerializedSchema): ValidationResult {
    return validateDefinition(definition);
  }

  public introspect(): Promise<SerializedSchema> {
    return introspectSchema(this._session);
  }

  public reconcile(
    local: SerializedSchema,
    remote: SerializedSchema,
    options: Partial<DDLOperationOptions> = {}
  ) {
    return reconcileSchemas(local, remote, options);
  }

  public async plan(
    definition: SerializedSchema,
    options: Partial<DDLOperationOptions> = {}
  ): Promise<PlanResult> {
    const validation = this.validate(definition);

    if (!validation.isValid) {
      throw new MigrationError("Schema validation failed", validation.errors);
    }

    const remote = await this.introspect();
    const { operations, errors } = this.reconcile(definition, remote, options);

    return {
      operations,
      destructive: operations.some((op) => op.type === "DROP"),
      errors,
    };
  }

  public async dryRun(definition: SerializedSchema, options: MigrationRunnerOptions = {}) {
    const { operations, errors, destructive } = await this.plan(definition, options);

    if (errors.length > 0) {
      throw new MigrationError("Schema reconciliation failed", errors);
    }

    if (destructive && !options.destructive) {
      throw new MigrationError(
        "Migration contains destructive operations. Set `destructive: true` in options to allow this."
      );
    }

    return operations.map((op) => this._print(op.statement));
  }

  public async run(definition: SerializedSchema, options: MigrationRunnerOptions = {}) {
    const { operations, errors, destructive } = await this.plan(definition, options);

    if (errors.length > 0) {
      throw new MigrationError("Schema reconciliation failed", errors);
    }

    const progress: OperationExecutionResult[] = [];

    if (destructive && !options.destructive) {
      throw new MigrationError(
        "Migration contains destructive operations. Set `destructive: true` in options to allow this."
      );
    }

    for (const op of operations) {
      let result = await this._executor.execute(op);

      if (result.status === "processing" && result.asyncJob) {
        result = await this._executor.waitAsyncJob(result);
      }

      progress.push(result);
    }

    return { count: progress.length, progress };
  }
}

export function createMigrationRunner(session: Session): MigrationRunner {
  return new MigrationRunner(session);
}
