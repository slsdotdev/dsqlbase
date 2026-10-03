import { Session, sql } from "@dsqlbase/core";
import { IndexedDDLOperation } from "./reconciliation/operations/index.js";
import { createPrinter } from "./ddl/index.js";

export type DDLQueryResult = { job_id: string } | undefined;

export type AsyncJobStatus = "submitted" | "processing" | "failed" | "completed";

export type AsyncJob = {
  jobId: string;
  status: AsyncJobStatus;
  type: string;
  details?: string;
};

export type OperationExecutionResult = {
  opId: number;
  sql: string;
  status: "processing" | "completed" | "failed";
  asyncJob?: AsyncJob;
  result?: unknown;
};

/** A `sys.jobs` row, as DSQL returns it. */
type AsyncJobRow = {
  job_id: string;
  status: AsyncJobStatus;
  job_type: string;
  details: string | null;
};

const toAsyncJob = (row: AsyncJobRow): AsyncJob => ({
  jobId: row.job_id,
  status: row.status,
  type: row.job_type,
  details: row.details ?? undefined,
});

const BACKFILL_ATTEMPTS = 5;

const isSerializationFailure = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "40001";

export class OperationExecutor {
  private _session: Session;
  private _print = createPrinter();

  constructor(session: Session) {
    this._session = session;
  }

  /**
   * The job's `sys.jobs` row. Columns are read by their own snake_case names: an unquoted
   * camelCase alias would fold to lower case and read back undefined.
   */
  public async getAsyncJob(jobId: string): Promise<AsyncJob | undefined> {
    const query = sql`
      SELECT job_id, status, job_type, details
      FROM sys.jobs
      WHERE job_id = ${jobId}
    `;

    const [row] = await this._session.execute<AsyncJobRow>(query.toQuery());
    return row ? toAsyncJob(row) : undefined;
  }

  public async waitAsyncJob(
    operationResult: OperationExecutionResult
  ): Promise<OperationExecutionResult> {
    if (!operationResult.asyncJob) {
      return operationResult;
    }

    const { jobId } = operationResult.asyncJob;

    // A procedure: `SELECT sys.wait_for_job(…)` is refused. It answers whether the job succeeded.
    const [wait] = await this._session.execute<{ succeeded: boolean }>(
      sql`CALL sys.wait_for_job(${jobId})`.toQuery()
    );
    // DSQL keeps finished jobs for 30 minutes; the row carries the failure details.
    const asyncJob = (await this.getAsyncJob(jobId)) ?? operationResult.asyncJob;
    const succeeded = wait?.succeeded ?? asyncJob.status === "completed";

    return {
      ...operationResult,
      status: succeeded ? "completed" : "failed",
      asyncJob: { ...asyncJob, status: succeeded ? "completed" : "failed" },
    };
  }

  /**
   * Refreshes every still-`processing` async job in `progress` with one `sys.jobs` read. For a
   * caller that submits independent async steps without waiting on each — an index on one table,
   * then another table's — and waits only before a step that depends on them, such as
   * `ADD CONSTRAINT … USING INDEX`. Results without a pending job are returned unchanged.
   */
  public async updatePendingJobsStatus(
    progress: OperationExecutionResult[]
  ): Promise<OperationExecutionResult[]> {
    const pendingJobIds = progress
      .filter((p) => p.status === "processing" && p.asyncJob)
      .map((p) => p.asyncJob?.jobId) as string[];

    if (pendingJobIds.length === 0) {
      return progress;
    }

    // One parameter per id: a JS array bound as one parameter is not a list of strings.
    const query = sql`
      SELECT job_id, status, job_type, details
      FROM sys.jobs
      WHERE ${sql.in("job_id", pendingJobIds)}
    `;

    const jobs = (await this._session.execute<AsyncJobRow>(query.toQuery())).map(toAsyncJob);
    const jobStatusMap = new Map(jobs.map((job) => [job.jobId, job]));

    return progress.map((current) => {
      if (current.asyncJob && jobStatusMap.has(current.asyncJob.jobId)) {
        const asyncJob = jobStatusMap.get(current.asyncJob.jobId);

        if (asyncJob) {
          return {
            ...current,
            status: asyncJob.status === "submitted" ? "processing" : asyncJob.status,
            asyncJob,
            result: asyncJob.details,
          };
        }
      }

      return current;
    });
  }

  /**
   * Runs a backfill batch after batch — each its own transaction, within DSQL's 3,000-row limit —
   * until one updates nothing. A batch that conflicts with a concurrent write (`40001`) is
   * retried; it only fills NULLs, so running it again is safe.
   */
  private async _backfill(operation: IndexedDDLOperation): Promise<OperationExecutionResult> {
    const statement = this._print(operation.statement);
    let rows = 0;

    for (;;) {
      let updated: number | undefined;

      for (let attempt = 1; updated === undefined; attempt++) {
        try {
          updated = (await this._session.execute(statement)).length;
        } catch (error) {
          if (!isSerializationFailure(error) || attempt >= BACKFILL_ATTEMPTS) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        }
      }

      rows += updated;
      if (updated === 0) break;
    }

    return { opId: operation.id, sql: statement.text, status: "completed", result: { rows } };
  }

  public async execute(operation: IndexedDDLOperation): Promise<OperationExecutionResult> {
    if (operation.statement.__kind === "BACKFILL") {
      try {
        return await this._backfill(operation);
      } catch (error) {
        return {
          opId: operation.id,
          sql: this._print(operation.statement).text,
          status: "failed",
          result: error,
        };
      }
    }

    try {
      const statement = this._print(operation.statement);
      const [result] = await this._session.execute<DDLQueryResult>(statement);

      if (result?.job_id) {
        const asyncJob: AsyncJob = (await this.getAsyncJob(result.job_id)) ?? {
          jobId: result.job_id,
          status: "submitted",
          type: "UNKNOWN",
        };
        const status = asyncJob.status === "submitted" ? "processing" : asyncJob.status;

        return {
          opId: operation.id,
          sql: statement.text,
          status,
          asyncJob,
        };
      }

      return {
        opId: operation.id,
        sql: statement.text,
        status: "completed",
        result,
      };
    } catch (error) {
      return {
        opId: operation.id,
        sql: this._print(operation.statement).text,
        status: "failed",
        result: error,
      };
    }
  }
}
