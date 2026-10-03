import { describe, expect, it } from "vitest";
import { Session, SQLStatement } from "@dsqlbase/core";
import { OperationExecutionResult, OperationExecutor } from "./executor.js";

/** Answers `sys.jobs` reads from a fixed table of jobs, and records each query. */
class JobsSession implements Session {
  public readonly queries: SQLStatement[] = [];

  constructor(private readonly jobs: Record<string, { status: string; details: string | null }>) {}

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    this.queries.push(query);
    return query.params
      .filter((id): id is string => typeof id === "string" && id in this.jobs)
      .map((id) => ({ job_id: id, job_type: "INDEX_BUILD", ...this.jobs[id] })) as T[];
  }
}

const pending = (opId: number, jobId: string): OperationExecutionResult => ({
  opId,
  sql: `CREATE INDEX ASYNC idx_${opId} ON t (c)`,
  status: "processing",
  asyncJob: { jobId, status: "submitted", type: "INDEX_BUILD" },
});

describe("OperationExecutor.updatePendingJobsStatus", () => {
  it("reads every pending job in one query, one parameter per job id", async () => {
    const session = new JobsSession({
      "job-1": { status: "completed", details: null },
      "job-2": { status: "failed", details: "duplicate key" },
    });
    const done: OperationExecutionResult = {
      opId: 0,
      sql: "CREATE TABLE t (c int)",
      status: "completed",
    };

    const updated = await new OperationExecutor(session).updatePendingJobsStatus([
      done,
      pending(1, "job-1"),
      pending(2, "job-2"),
    ]);

    expect(session.queries).toHaveLength(1);
    expect(session.queries[0]?.text).toMatch(/job_id" IN \(\$1, \$2\)/);
    expect(session.queries[0]?.params).toEqual(["job-1", "job-2"]);
    expect(updated.map((result) => [result.opId, result.status])).toEqual([
      [0, "completed"],
      [1, "completed"],
      [2, "failed"],
    ]);
    expect(updated[2]?.result).toBe("duplicate key");
  });

  it("keeps a job still running as processing", async () => {
    const session = new JobsSession({ "job-1": { status: "submitted", details: null } });

    const [updated] = await new OperationExecutor(session).updatePendingJobsStatus([
      pending(1, "job-1"),
    ]);

    expect(updated?.status).toBe("processing");
  });

  it("queries nothing when no job is pending", async () => {
    const session = new JobsSession({});
    const done: OperationExecutionResult = {
      opId: 0,
      sql: "CREATE TABLE t (c int)",
      status: "completed",
    };

    expect(await new OperationExecutor(session).updatePendingJobsStatus([done])).toEqual([done]);
    expect(session.queries).toEqual([]);
  });
});
