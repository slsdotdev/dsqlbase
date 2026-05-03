import { Session, sql } from "@dsqlbase/core";
import { IndexedDDLOperation } from "./reconciliation/operations/index.js";
import { createPrinter } from "./ddl/index.js";

export type DDLQueryResult = { job_id: string } | undefined;

export type AsyncJobStatus = "submitted" | "processing" | "failed" | "completed";

export interface AsyncJob {
  jobId: string;
  status: AsyncJobStatus;
  type: string;
  details?: string;
}

export interface OperationExecutionResult {
  opId: number;
  sql: string;
  status: "processing" | "completed" | "failed";
  asyncJob?: AsyncJob;
  result?: unknown;
}

export class OperationExecutor {
  private _session: Session;
  private _print = createPrinter();

  constructor(session: Session) {
    this._session = session;
  }

  public async getAsyncJob(jobId: string): Promise<AsyncJob> {
    const query = sql`
      SELECT job_id as jobId, status, job_type as type, details 
      FROM sys.jobs 
      WHERE job_id = ${jobId}
    `;

    const [job] = await this._session.execute<AsyncJob>(query.toQuery());
    return job;
  }

  public async waitAsyncJob(
    operationResult: OperationExecutionResult
  ): Promise<OperationExecutionResult> {
    if (!operationResult.asyncJob) {
      return operationResult;
    }

    const query = sql`
      call sys.wait_for_job(${operationResult.asyncJob.jobId})
    `;

    await this._session.execute<AsyncJob>(query.toQuery());
    const asyncJob = await this.getAsyncJob(operationResult.asyncJob.jobId);

    return {
      ...operationResult,
      status: asyncJob.status === "completed" ? "completed" : "failed",
      asyncJob,
    };
  }

  public async updatePendingJobsStatus(
    progress: OperationExecutionResult[]
  ): Promise<OperationExecutionResult[]> {
    const pendingJobIds = progress
      .filter((p) => p.status === "processing" && p.asyncJob)
      .map((p) => p.asyncJob?.jobId) as string[];

    if (pendingJobIds.length === 0) {
      return progress;
    }

    const query = sql`
      SELECT job_id as jobId, status, job_type as type, details 
      FROM sys.jobs 
      WHERE job_id IN (${pendingJobIds})
    `;

    const jobs = await this._session.execute<AsyncJob>(query.toQuery());
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

  public async execute(operation: IndexedDDLOperation): Promise<OperationExecutionResult> {
    try {
      const statement = this._print(operation.statement);
      const [result] = await this._session.execute<DDLQueryResult>(statement);

      if (result?.job_id) {
        const asyncJob = await this.getAsyncJob(result.job_id);
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
