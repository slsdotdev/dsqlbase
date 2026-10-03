import { Session } from "@dsqlbase/core";
import { MigrationError, SerializedSchema } from "./base.js";
import { createPrinter } from "./ddl/printer.js";
import { introspect as introspectSchema } from "./introspection/introspect.js";
import {
  DDLOperationError,
  IndexedDDLOperation,
  maxRisk,
  OperationRisk,
} from "./reconciliation/operations/index.js";
import { ExecutedPlanRow, PlanRow, planRows } from "./report.js";
import { reconcileSchemas } from "./reconciliation/reconcile.js";
import { ValidationResult } from "./validation/index.js";
import { validateDefinition } from "./validation/validate.js";
import { OperationExecutionResult, OperationExecutor } from "./executor.js";
import { DDLOperationOptions } from "./reconciliation/operations/base.js";

/**
 * Which risks `run` and `dryRun` may carry out. `safe` steps always may. See
 * {@link OperationRisk}.
 */
export type AllowedRisks = {
  /**
   * Steps that remove what redeploying the previous definition restores — an index, a default,
   * a constraint. No row data is lost.
   * @default true
   */
  lossy?: boolean;
  /**
   * Steps that cannot be undone by redeploying: dropped tables, columns, sequences, domains,
   * schemas, or what DSQL cannot re-create.
   *
   * **⚠️ Warning:** loses data.
   *
   * @default false
   */
  destructive?: boolean;
};

export type MigrationRunnerOptions = {
  allow?: AllowedRisks;
} & Partial<DDLOperationOptions>;

export type PlanResult = {
  operations: IndexedDDLOperation[];
  errors: DDLOperationError[];
  /** The highest risk among the operations; `safe` for an empty plan. */
  risk: OperationRisk;
  /**
   * One row per operation in execution order, then one per refusal. A row is `blocked` when
   * the `allow` passed to `plan` does not cover its risk. See `formatPlan`.
   */
  rows: PlanRow[];
};

export type RunResult = {
  count: number;
  progress: OperationExecutionResult[];
  /** The plan's operation rows, each with how its statement went. */
  rows: ExecutedPlanRow[];
};

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
    options: MigrationRunnerOptions = {}
  ): Promise<PlanResult> {
    const validation = this.validate(definition);

    if (!validation.isValid) {
      throw new MigrationError("Schema validation failed", validation.errors);
    }

    const remote = await this.introspect();
    const { operations, errors } = this.reconcile(definition, remote, options);

    const allowed = allowedRisks(options.allow);

    return {
      operations,
      errors,
      risk: operations.reduce<OperationRisk>((risk, op) => maxRisk(risk, op.summary.risk), "safe"),
      rows: planRows(operations, errors, (op) => this._print(op.statement)).map((row) => ({
        ...row,
        blocked: row.risk === "refused" || !allowed.has(row.risk),
      })),
    };
  }

  /**
   * Throws when the plan cannot run as allowed: any refusal, or any step whose risk `allow`
   * does not cover. Every offending row is listed.
   */
  private _assertRunnable({ errors, rows }: PlanResult) {
    if (errors.length > 0) {
      throw new MigrationError("Schema reconciliation failed", errors);
    }

    const blocked = rows.filter((row) => row.blocked);

    if (blocked.length > 0) {
      throw new MigrationError(
        "The plan has steps whose risk is not allowed.",
        blocked.map((row) => ({
          code: `${row.risk.toUpperCase()}_NOT_ALLOWED`,
          message:
            `step ${row.step}: ${row.action} ${row.targetKind?.toLowerCase() ?? row.subjectKind.toLowerCase()} ` +
            `${row.target ?? row.subject} on ${row.subject} is ${row.risk}; ` +
            `pass allow: { ${row.risk}: true } to run it` +
            (row.note ? ` (${row.note})` : ""),
        }))
      );
    }
  }

  public async dryRun(definition: SerializedSchema, options: MigrationRunnerOptions = {}) {
    const plan = await this.plan(definition, options);

    this._assertRunnable(plan);

    return plan.operations.map((op) => this._print(op.statement));
  }

  public async run(
    definition: SerializedSchema,
    options: MigrationRunnerOptions = {}
  ): Promise<RunResult> {
    const plan = await this.plan(definition, options);
    const { operations, rows } = plan;

    this._assertRunnable(plan);

    const progress: OperationExecutionResult[] = [];
    const executed: ExecutedPlanRow[] = [];

    for (const [index, op] of operations.entries()) {
      // A failed step stops the run: later steps may depend on it. A re-run plans from the
      // database as it now is, so it resumes where this one stopped.
      if (executed.some((row) => row.status === "failed")) {
        executed.push({ ...rows[index], status: "skipped", durationMs: 0, error: null });
        continue;
      }

      const started = Date.now();
      let result = await this._executor.execute(op);

      if (result.status === "processing" && result.asyncJob) {
        // A wait that fails (the call errors, or the connection drops) fails the step: the job
        // may still finish, and a re-run plans from wherever it got to.
        result = await this._executor.waitAsyncJob(result).catch(
          (error: unknown): OperationExecutionResult => ({
            ...result,
            status: "failed",
            result: error,
          })
        );
      }

      progress.push(result);
      executed.push({
        ...rows[index],
        status: result.status,
        durationMs: Date.now() - started,
        error: result.status === "failed" ? describeFailure(result) : null,
      });
    }

    const result: RunResult = { count: progress.length, progress, rows: executed };
    const failed = executed.find((row) => row.status === "failed");

    if (failed) {
      throw new MigrationError(
        "A migration step failed; the steps after it were skipped.",
        [
          {
            code: "STEP_FAILED",
            message:
              `step ${failed.step}: ${failed.action} ${failed.target ?? failed.subject} on ` +
              `${failed.subject} failed: ${failed.error ?? "failed"}`,
          },
        ],
        { result, cause: errorOf(progress.find((p) => p.status === "failed")) }
      );
    }

    return result;
  }
}

function allowedRisks(allow: AllowedRisks = {}): Set<OperationRisk> {
  const allowed = new Set<OperationRisk>(["safe"]);
  if (allow.lossy ?? true) allowed.add("lossy");
  if (allow.destructive ?? false) allowed.add("destructive");
  return allowed;
}

/** The error a failed step threw; an async job that failed carries details, not an error. */
function errorOf(result: OperationExecutionResult | undefined): Error | undefined {
  return result?.result instanceof Error ? result.result : undefined;
}

function describeFailure(result: OperationExecutionResult): string {
  if (result.asyncJob?.details) return result.asyncJob.details;
  if (result.result instanceof Error) return result.result.message;
  return "failed";
}

export function createMigrationRunner(session: Session): MigrationRunner {
  return new MigrationRunner(session);
}
