import { beforeEach, describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  DomainDefinition,
  SequenceDefinition,
  Session,
  SQLStatement,
  TableDefinition,
} from "@dsqlbase/core";
import { getSerializedSchemaObjects, MigrationError, SerializedSchema } from "./base.js";
import { createMigrationRunner, MigrationRunner } from "./runner.js";
import { AsyncJob } from "./executor.js";

type SessionLog = {
  text: string;
  params: readonly unknown[];
};

class TestSession implements Session {
  public readonly executed: SessionLog[] = [];
  public introspection: SerializedSchema = [];
  public ddlResponses = new Map<string, unknown[]>();
  public asyncJobs = new Map<string, AsyncJob>();

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    this.executed.push({ text: query.text, params: query.params });

    if (this._isIntrospectionQuery(query.text)) {
      return [{ definitions: this.introspection }] as T[];
    }

    // Rows shaped as DSQL returns them: `sys.jobs` columns are snake_case, and
    // `CALL sys.wait_for_job` answers `{ succeeded }`.
    if (this._isJobLookupQuery(query.text)) {
      const jobId = query.params[0] as string;
      const job = this.asyncJobs.get(jobId);
      return job
        ? ([
            { job_id: job.jobId, status: job.status, job_type: job.type, details: job.details },
          ] as T[])
        : ([] as T[]);
    }

    if (this._isWaitForJobQuery(query.text)) {
      const jobId = query.params[0] as string;
      const job = this.asyncJobs.get(jobId);
      if (job && job.status !== "failed") {
        this.asyncJobs.set(jobId, { ...job, status: "completed" });
      }
      return [{ succeeded: job !== undefined && job.status !== "failed" }] as T[];
    }

    const ddlResponse = this.ddlResponses.get(query.text.trim());
    if (ddlResponse) return ddlResponse as T[];

    return [] as T[];
  }

  private _isIntrospectionQuery(text: string): boolean {
    return text.includes("schema_defs") || text.includes("'kind', 'TABLE'");
  }

  private _isJobLookupQuery(text: string): boolean {
    return text.includes("FROM sys.jobs");
  }

  private _isWaitForJobQuery(text: string): boolean {
    return text.includes("sys.wait_for_job");
  }

  public stubAsyncOperation(
    statementText: string,
    jobId: string,
    finalStatus: AsyncJob["status"] = "completed"
  ) {
    const initial: AsyncJob = { jobId, status: "submitted", type: "CREATE_INDEX" };
    this.asyncJobs.set(jobId, initial);
    this.ddlResponses.set(statementText, [{ job_id: jobId }]);

    if (finalStatus === "failed") {
      this.asyncJobs.set(jobId, { ...initial, status: "failed", details: "synthetic failure" });
    }
  }

  public count(predicate: (entry: SessionLog) => boolean): number {
    return this.executed.filter(predicate).length;
  }
}

const usersTable = new TableDefinition("users", {
  columns: {
    id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
    name: new ColumnDefinition("name", { dataType: "text" }).notNull(),
    email: new ColumnDefinition("email", { dataType: "varchar(200)" }).notNull(),
  },
});

const noPkTable = new TableDefinition("invalid", {
  columns: {
    name: new ColumnDefinition("name", { dataType: "text" }).notNull(),
  },
});

const orphanTable = new TableDefinition("orphan", {
  columns: {
    id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
  },
});

// `users` as introspection reads it back: its key as a named constraint.
const introspectedUsers = () => {
  const usersJson = usersTable.toJSON();
  return {
    ...usersJson,
    constraints: [
      ...usersJson.constraints,
      { kind: "PRIMARY_KEY_CONSTRAINT", name: "users_pkey", columns: ["id"], include: null },
    ],
  } as typeof usersJson;
};

describe("MigrationRunner", () => {
  let session: TestSession;
  let runner: MigrationRunner;

  beforeEach(() => {
    session = new TestSession();
    runner = createMigrationRunner(session);
  });

  describe("plan", () => {
    it("plans a create-from-empty migration", async () => {
      const result = await runner.plan([usersTable.toJSON()]);

      expect(result.errors).toEqual([]);
      expect(result.risk).toBe("safe");
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        type: "CREATE",
        statement: { __kind: "CREATE_TABLE", name: "users" },
      });
    });

    it("flags destructive when the remote has objects missing locally", async () => {
      const usersJson = usersTable.toJSON();
      session.introspection = [
        {
          ...usersJson,
          constraints: [
            ...usersJson.constraints,
            {
              kind: "PRIMARY_KEY_CONSTRAINT",
              name: "users_pkey",
              columns: ["id"],
              include: null,
            },
          ],
        },
        orphanTable.toJSON(),
      ];

      const result = await runner.plan([usersJson]);

      expect(result.errors).toEqual([]);
      expect(result.risk).toBe("destructive");
      expect(result.operations.some((op) => op.type === "DROP")).toBe(true);
    });

    it("throws when the definition is invalid", async () => {
      await expect(runner.plan([noPkTable.toJSON()])).rejects.toBeInstanceOf(MigrationError);
    });

    it("reports the plan as rows, with its highest risk", async () => {
      session.introspection = [introspectedUsers(), orphanTable.toJSON()];

      const result = await runner.plan([usersTable.toJSON()]);

      expect(result.risk).toBe("destructive");
      expect(result.rows).toEqual([
        expect.objectContaining({
          step: 1,
          subject: orphanTable.name,
          action: "DROP",
          risk: "destructive",
          destructive: true,
          sql: expect.stringMatching(/^DROP TABLE/),
        }),
      ]);
    });

    it("rates an empty plan safe, with no rows", async () => {
      session.introspection = [introspectedUsers()];

      expect(await runner.plan([usersTable.toJSON()])).toMatchObject({ risk: "safe", rows: [] });
    });

    it("collects refusals from reconciliation in errors[]", async () => {
      const remote = new TableDefinition("users", {
        columns: {
          id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
          name: new ColumnDefinition("name", { dataType: "text" }).notNull(),
          email: new ColumnDefinition("email", { dataType: "varchar(200)" }).notNull(),
          legacy: new ColumnDefinition("legacy", { dataType: "text" }),
        },
      });

      session.introspection = [remote.toJSON()];
      const result = await runner.plan([usersTable.toJSON()]);

      expect(result.errors.some((e) => e.code === "NO_DROP_COLUMN")).toBe(true);
    });
  });

  describe("dryRun", () => {
    it("returns printed SQL and never executes DDL", async () => {
      const statements = await runner.dryRun([usersTable.toJSON()]);

      expect(statements).toHaveLength(1);
      expect(statements[0].text).toContain("CREATE TABLE");
      expect(session.executed).toHaveLength(1);
    });

    it("aborts when the migration contains destructive ops, naming each step", async () => {
      session.introspection = [introspectedUsers(), orphanTable.toJSON()];

      const error = await runner.dryRun([usersTable.toJSON()]).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).issues).toEqual([
        {
          code: "DESTRUCTIVE_NOT_ALLOWED",
          message:
            "step 1: DROP table orphan on orphan is destructive; pass allow: { destructive: true } to run it",
        },
      ]);
    });

    it("allows lossy steps by default, and refuses them with allow.lossy false", async () => {
      const remote = introspectedUsers();
      session.introspection = [
        {
          ...remote,
          indexes: [
            {
              kind: "INDEX",
              name: "users_name_idx",
              unique: false,
              distinctNulls: true,
              columns: [
                {
                  kind: "INDEX_COLUMN",
                  name: "users_name_idx_column_name",
                  nulls: "LAST",
                  column: "name",
                },
              ],
              include: null,
            },
          ],
        } as typeof remote,
      ];

      expect(await runner.dryRun([usersTable.toJSON()])).toHaveLength(1);
      await expect(
        runner.dryRun([usersTable.toJSON()], { allow: { lossy: false } })
      ).rejects.toThrow(/LOSSY_NOT_ALLOWED/);
    });

    it("marks the rows a plan would not be allowed to run", async () => {
      session.introspection = [introspectedUsers(), orphanTable.toJSON()];

      const blocked = await runner.plan([usersTable.toJSON()]);
      const allowed = await runner.plan([usersTable.toJSON()], { allow: { destructive: true } });

      expect(blocked.rows.map((row) => row.blocked)).toEqual([true]);
      expect(allowed.rows.map((row) => row.blocked)).toEqual([false]);
    });

    it("surfaces destructive ops when allowed", async () => {
      const usersJson = usersTable.toJSON();
      session.introspection = [
        {
          ...usersJson,
          constraints: [
            ...usersJson.constraints,
            {
              kind: "PRIMARY_KEY_CONSTRAINT",
              name: "users_pkey",
              columns: ["id"],
              include: null,
            },
          ],
        },
        orphanTable.toJSON(),
      ];

      const statements = await runner.dryRun([usersJson], { allow: { destructive: true } });

      expect(statements.some((s) => s.text.startsWith("DROP TABLE"))).toBe(true);
    });
  });

  describe("run", () => {
    it("returns each row with how its statement went", async () => {
      const result = await runner.run([usersTable.toJSON()]);

      expect(result.rows).toEqual([
        expect.objectContaining({
          step: 1,
          action: "CREATE",
          status: "completed",
          durationMs: expect.any(Number),
          error: null,
        }),
      ]);
    });

    it("executes operations in plan order against the session", async () => {
      const result = await runner.run([usersTable.toJSON()]);

      expect(result.count).toBe(1);
      expect(result.progress[0]).toMatchObject({ status: "completed", opId: 0 });
      expect(session.count((q) => q.text.startsWith("CREATE TABLE"))).toBe(1);
    });

    it("aborts before any DDL when validation fails", async () => {
      await expect(runner.run([noPkTable.toJSON()])).rejects.toBeInstanceOf(MigrationError);
      expect(session.count((q) => q.text.startsWith("CREATE"))).toBe(0);
    });

    it("aborts with MigrationError when reconciliation surfaces refusals", async () => {
      const remote = new TableDefinition("users", {
        columns: {
          id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
          name: new ColumnDefinition("name", { dataType: "text" }).notNull(),
          email: new ColumnDefinition("email", { dataType: "varchar(200)" }).notNull(),
          legacy: new ColumnDefinition("legacy", { dataType: "text" }),
        },
      });
      session.introspection = [remote.toJSON()];

      await expect(runner.run([usersTable.toJSON()])).rejects.toBeInstanceOf(MigrationError);
      expect(session.count((q) => q.text.startsWith("ALTER"))).toBe(0);
    });

    it("requires opt-in for destructive migrations", async () => {
      session.introspection = [introspectedUsers(), orphanTable.toJSON()];

      await expect(runner.run([usersTable.toJSON()])).rejects.toThrow(/DESTRUCTIVE_NOT_ALLOWED/);
      expect(session.count((q) => q.text.startsWith("DROP"))).toBe(0);
    });

    it("runs destructive operations when explicitly opted-in", async () => {
      const usersJson = usersTable.toJSON();
      session.introspection = [
        {
          ...usersJson,
          constraints: [
            ...usersJson.constraints,
            {
              kind: "PRIMARY_KEY_CONSTRAINT",
              name: "users_pkey",
              columns: ["id"],
              include: null,
            },
          ],
        },
        orphanTable.toJSON(),
      ];

      const result = await runner.run([usersJson], { allow: { destructive: true } });

      expect(result.progress.every((p) => p.status === "completed")).toBe(true);
      expect(session.count((q) => q.text.startsWith("DROP TABLE"))).toBe(1);
    });

    it("polls async jobs to completion when the DDL returns a job_id", async () => {
      const tableWithIndex = new TableDefinition("widgets", {
        columns: {
          id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
          slug: new ColumnDefinition("slug", { dataType: "text" }).notNull(),
        },
      });

      tableWithIndex.index("widgets_slug_idx", { unique: true }).columns((c) => [c.slug]);

      const statements = await runner.dryRun([tableWithIndex.toJSON()]);
      const indexStmt = statements.find((s) => s.text.includes("CREATE UNIQUE INDEX"));

      expect(indexStmt).toBeDefined();

      session.stubAsyncOperation(indexStmt?.text.trim() ?? "", "job-1");
      const result = await runner.run([tableWithIndex.toJSON()]);

      const indexProgress = result.progress.find((p) => p.sql.includes("CREATE UNIQUE INDEX"));
      expect(indexProgress).toMatchObject({
        status: "completed",
        asyncJob: { jobId: "job-1" },
      });
      expect(session.count((q) => q.text.includes("sys.wait_for_job"))).toBe(1);
      // An undefined id here is `sys.wait_for_job(NULL)`, which blocks forever on DSQL.
      expect(session.executed.find((q) => q.text.includes("sys.wait_for_job"))?.params).toEqual([
        "job-1",
      ]);
    });

    it("marks operation as failed when the async job ends in failed state", async () => {
      const tableWithIndex = new TableDefinition("widgets", {
        columns: {
          id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
          slug: new ColumnDefinition("slug", { dataType: "text" }).notNull(),
        },
      });
      tableWithIndex.index("widgets_slug_idx").columns((c) => [c.slug]);

      const statements = await runner.dryRun([tableWithIndex.toJSON()]);
      const indexStmt = statements.find((s) => s.text.includes("CREATE INDEX"));
      session.stubAsyncOperation(indexStmt?.text.trim() ?? "", "job-2", "failed");

      const result = await runner.run([tableWithIndex.toJSON()]);
      const indexProgress = result.progress.find((p) => p.sql.includes("CREATE INDEX"));

      expect(indexProgress?.status).toBe("failed");
    });

    it("stops at a failed step and reports the rest as skipped", async () => {
      const widgets = new TableDefinition("widgets", {
        columns: {
          id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
          slug: new ColumnDefinition("slug", { dataType: "text" }).notNull(),
          name: new ColumnDefinition("name", { dataType: "text" }).notNull(),
        },
      });
      widgets.index("widgets_slug_idx").columns((c) => [c.slug]);
      widgets.index("widgets_name_idx").columns((c) => [c.name]);

      const statements = await runner.dryRun([widgets.toJSON()]);
      const slugIndex = statements.find((s) => s.text.includes("widgets_slug_idx"));
      session.stubAsyncOperation(slugIndex?.text.trim() ?? "", "job-3", "failed");

      const result = await runner.run([widgets.toJSON()]);

      expect(result.rows.map((row) => [row.target ?? row.subject, row.status])).toEqual([
        ["widgets", "completed"],
        ["widgets_slug_idx", "failed"],
        ["widgets_name_idx", "skipped"],
      ]);
      expect(result.rows[1]?.error).toBe("synthetic failure");
      expect(session.count((q) => q.text.includes("widgets_name_idx"))).toBe(0);
    });

    it("plans domain + table + sequence in dependency order", async () => {
      const status = new DomainDefinition("status", { dataType: "text" }).$type<
        "open" | "closed"
      >();
      const counter = new SequenceDefinition("counter").startWith(1);

      const tickets = new TableDefinition("tickets", {
        columns: {
          id: new ColumnDefinition("id", { dataType: "uuid" }).primaryKey(),
          state: status.column("state").notNull(),
          seq: new ColumnDefinition("seq", { dataType: "int" }).notNull(),
        },
      });

      const definitions = getSerializedSchemaObjects([status, counter, tickets]);
      const result = await runner.run(definitions);

      const order = result.progress.map((p) => {
        if (p.sql.startsWith("CREATE DOMAIN")) return "domain";
        if (p.sql.startsWith("CREATE TABLE")) return "table";
        if (p.sql.startsWith("CREATE SEQUENCE")) return "sequence";
        return "other";
      });

      expect(order.indexOf("domain")).toBeLessThan(order.indexOf("table"));
    });
  });
});
