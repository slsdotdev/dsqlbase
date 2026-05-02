import { describe, expect, it } from "vitest";
import { sql } from "@dsqlbase/core";
import { withSeededClient } from "../fixures/seeded-client";

describe("select operations", () => {
  const { getClient, getData } = withSeededClient();

  describe("findOne", () => {
    it("returns a row matched by primary key", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.findOne({
        where: { id: { eq: data.users[0].id } },
      });

      expect(result).toMatchObject({
        id: data.users[0].id,
        name: data.users[0].name,
        email: data.users[0].email,
      });
    });

    it("supports value-shorthand in where", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.findOne({
        where: { email: data.users[1].email },
      });

      expect(result?.id).toBe(data.users[1].id);
    });

    it("returns null when no row matches", async () => {
      const client = getClient();

      const result = await client.users.findOne({
        where: { id: { eq: "00000000-0000-0000-0000-000000000000" } },
      });

      expect(result).toBeNull();
    });

    it("projects only the requested fields with `select`", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.findOne({
        select: { id: true, email: true },
        where: { id: { eq: data.users[0].id } },
      });

      expect(result).toEqual({
        id: data.users[0].id,
        email: data.users[0].email,
      });
    });
  });

  describe("findMany", () => {
    it("returns every row when no filters are supplied", async () => {
      const client = getClient();

      const result = await client.users.findMany({});

      expect(result).toHaveLength(4);
    });

    it("applies `limit`", async () => {
      const client = getClient();

      const result = await client.tasks.findMany({ limit: 2 });

      expect(result).toHaveLength(2);
    });

    it("applies `offset` and `limit` together for pagination", async () => {
      const client = getClient();

      const all = await client.users.findMany({ orderBy: { email: "asc" } });
      const page = await client.users.findMany({
        orderBy: { email: "asc" },
        limit: 2,
        offset: 1,
      });

      expect(page).toHaveLength(2);
      expect(page.map((u) => u.id)).toEqual([all[1].id, all[2].id]);
    });

    it("orders ascending and descending", async () => {
      const client = getClient();

      const asc = await client.users.findMany({ orderBy: { email: "asc" } });
      const desc = await client.users.findMany({ orderBy: { email: "desc" } });

      expect(asc.map((u) => u.email)).toEqual([...asc.map((u) => u.email)].sort());
      expect(desc.map((u) => u.email)).toEqual([...asc].reverse().map((u) => u.email));
    });

    it("orders by multiple keys", async () => {
      const client = getClient();

      const result = await client.tasks.findMany({
        orderBy: { status: "asc", title: "asc" },
      });

      expect(result).toHaveLength(6);
    });

    it("returns distinct rows when `distinct` is true", async () => {
      const client = getClient();

      const result = await client.tasks.findMany({
        select: { status: true },
        distinct: true,
        orderBy: { status: "asc" },
      });

      const statuses = result.map((r) => r.status);
      expect(new Set(statuses).size).toBe(statuses.length);
      expect(statuses).toContain("todo");
      expect(statuses).toContain("in_progress");
      expect(statuses).toContain("done");
    });
  });

  describe("filter operators", () => {
    it("`eq` and `neq`", async () => {
      const client = getClient();

      const archived = await client.projects.findMany({
        where: { isArchived: { eq: true } },
      });
      const active = await client.projects.findMany({
        where: { isArchived: { neq: true } },
      });

      expect(archived).toHaveLength(1);
      expect(active).toHaveLength(2);
    });

    it("`gt`, `gte`, `lt`, `lte` over dates", async () => {
      const client = getClient();

      const cutoff = new Date("2026-05-15");
      const after = await client.tasks.findMany({ where: { dueDate: { gt: cutoff } } });
      const onOrAfter = await client.tasks.findMany({ where: { dueDate: { gte: cutoff } } });
      const before = await client.tasks.findMany({ where: { dueDate: { lt: cutoff } } });
      const onOrBefore = await client.tasks.findMany({ where: { dueDate: { lte: cutoff } } });

      expect(after.map((t) => t.title)).toEqual(["Write API documentation"]);
      expect(onOrAfter.map((t) => t.title).sort()).toEqual([
        "User settings page",
        "Write API documentation",
      ]);
      expect(before.map((t) => t.title)).toEqual(["Setup authentication"]);
      expect(onOrBefore.map((t) => t.title).sort()).toEqual([
        "Setup authentication",
        "User settings page",
      ]);
    });

    it("`in` against a domain column", async () => {
      const client = getClient();

      const result = await client.tasks.findMany({
        where: { status: { in: ["todo", "done"] } },
      });

      expect(result).toHaveLength(4);
      for (const task of result) {
        expect(["todo", "done"]).toContain(task.status);
      }
    });

    it("`between` on a date column", async () => {
      const client = getClient();

      const result = await client.tasks.findMany({
        where: {
          dueDate: { between: [new Date("2026-05-01"), new Date("2026-05-31")] },
        },
        orderBy: { dueDate: "asc" },
      });

      expect(result.map((t) => t.title)).toEqual(["Setup authentication", "User settings page"]);
    });

    it("`beginsWith`, `endsWith`, `contains`", async () => {
      const client = getClient();

      const begins = await client.users.findMany({
        where: { name: { beginsWith: "A" } },
      });
      const ends = await client.users.findMany({
        where: { email: { endsWith: "@example.com" } },
      });
      const contains = await client.tasks.findMany({
        where: { title: { contains: "page" } },
      });

      expect(begins.map((u) => u.name)).toEqual(["Alice Johnson"]);
      expect(ends).toHaveLength(4);
      expect(contains.map((t) => t.title)).toEqual(["User settings page"]);
    });

    it("`exists` for null / not-null", async () => {
      const client = getClient();

      const withAssignee = await client.tasks.findMany({
        where: { assigneeId: { exists: true } },
      });
      const unassigned = await client.tasks.findMany({
        where: { assigneeId: { exists: false } },
      });
      const withDueDate = await client.tasks.findMany({
        where: { dueDate: { exists: true } },
      });

      expect(withAssignee).toHaveLength(5);
      expect(unassigned).toHaveLength(1);
      expect(withDueDate).toHaveLength(3);
    });

    it("composes with `and` / `or`", async () => {
      const client = getClient();

      const result = await client.projects.findMany({
        select: { id: true, teamId: true, name: true, isArchived: true },
        where: {
          and: [
            { or: [{ name: { contains: "API" } }, { name: { contains: "Web" } }] },
            { isArchived: { neq: true } },
          ],
        },
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Web Dashboard");
    });

    it("inverts with `not`", async () => {
      const client = getClient();

      const result = await client.projects.findMany({
        where: { not: { isArchived: { eq: true } } },
      });

      expect(result).toHaveLength(2);
      for (const project of result) {
        expect(project.isArchived).toBe(false);
      }
    });
  });

  describe("joins", () => {
    it("belongsTo (one) — task → project", async () => {
      const client = getClient();
      const data = getData();

      // seed order: tasks[0] = "Setup authentication" on projects[0] (API Platform)
      const apiTask = data.tasks[0];
      const result = await client.tasks.findOne({
        where: { id: { eq: apiTask.id } },
        select: { id: true, title: true },
        join: {
          project: { select: { id: true, name: true } },
        },
      });

      expect(result).toMatchObject({
        title: "Setup authentication",
        project: { name: "API Platform" },
      });
    });

    it("belongsTo nullable — task → assignee can be null", async () => {
      const client = getClient();
      const data = getData();

      // seed order: tasks[2] is the "Write API documentation" task with assignee_id NULL
      const orphan = data.tasks[2];
      const result = await client.tasks.findOne({
        where: { id: { eq: orphan.id } },
        select: { id: true, title: true },
        join: { assignee: { select: { id: true, name: true } } },
      });

      expect(result?.assignee).toBeNull();
    });

    it("hasMany — project → tasks", async () => {
      const client = getClient();
      const data = getData();

      // seed order: projects[0] = API Platform, has 3 tasks
      const apiProject = data.projects[0];
      const result = await client.projects.findOne({
        where: { id: { eq: apiProject.id } },
        select: { id: true, name: true },
        join: { tasks: { select: { id: true, title: true } } },
      });

      expect(result?.tasks).toHaveLength(3);
      expect(result?.tasks.map((t) => t.title).sort()).toEqual([
        "Implement rate limiting",
        "Setup authentication",
        "Write API documentation",
      ]);
    });

    it("hasOne — user → membership", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.findOne({
        where: { id: { eq: data.users[0].id } },
        select: { id: true, name: true },
        join: { membership: { select: { role: true } } },
      });

      expect(result?.membership?.role).toBe("admin");
    });

    it("nested join filters child rows independently of the parent", async () => {
      const client = getClient();
      const data = getData();

      const apiProject = data.projects[0];
      const result = await client.projects.findOne({
        where: { id: { eq: apiProject.id } },
        select: { id: true, name: true },
        join: {
          tasks: {
            select: { id: true, title: true },
            where: { status: { eq: "todo" } },
          },
        },
      });

      expect(result?.tasks.map((t) => t.title).sort()).toEqual([
        "Implement rate limiting",
        "Write API documentation",
      ]);
    });

    it("multi-level nested join (3 deep): user → tasks → project", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.findOne({
        select: { id: true, name: true },
        where: { id: { eq: data.users[1].id } },
        join: {
          tasks: {
            select: { title: true, dueDate: true },
            where: { dueDate: { exists: true } },
            join: {
              project: { select: { name: true } },
            },
          },
        },
      });

      expect(result).toMatchObject({
        id: data.users[1].id,
        name: data.users[1].name,
        tasks: expect.arrayContaining([
          expect.objectContaining({
            title: expect.any(String),
            dueDate: expect.any(Date),
            project: expect.objectContaining({ name: expect.any(String) }),
          }),
        ]),
      });
    });
  });

  describe("type round-trips", () => {
    it("returns `date` columns as `Date` instances", async () => {
      const client = getClient();

      const tasks = await client.tasks.findMany({
        where: { dueDate: { exists: true } },
      });

      for (const task of tasks) {
        expect(task.dueDate).toBeInstanceOf(Date);
      }
    });

    it("returns `datetime` (timestamptz) columns as `Date` instances", async () => {
      const client = getClient();

      const teams = await client.teams.findMany({});

      for (const team of teams) {
        expect(team.createdAt).toBeInstanceOf(Date);
        expect(team.updatedAt).toBeInstanceOf(Date);
      }
    });

    it("returns `boolean` columns as JS booleans", async () => {
      const client = getClient();

      const projects = await client.projects.findMany({});

      for (const project of projects) {
        expect(typeof project.isArchived).toBe("boolean");
      }
    });

    it("returns `domain` columns as strings of the allowed values", async () => {
      const client = getClient();

      const tasks = await client.tasks.findMany({});

      for (const task of tasks) {
        expect(["todo", "in_progress", "done", "archived"]).toContain(task.status);
        expect(["urgent", "high", "medium", "low", "none"]).toContain(task.priority);
      }
    });
  });

  describe("$raw escape hatch", () => {
    it("runs a hand-written lateral-join query", async () => {
      const client = getClient();

      const query = sql`
        SELECT "id", "title", "description", "__rel_assignee"."data" AS "assignee" FROM "tasks"
        LEFT JOIN LATERAL (
          SELECT row_to_json("__t".*) AS "data"
          FROM (
            SELECT "id", "name", "email"
            FROM "users"
            WHERE "users"."id" = "tasks"."assignee_id"
          ) AS "__t"
        ) AS "__rel_assignee"
        ON true
      `;

      const results = await client.$raw<{
        id: string;
        title: string;
        description: string | null;
        assignee: { id: string; name: string; email: string } | null;
      }>(query);

      const taskWithAssignee = results.filter((r) => r.assignee !== null);

      expect(results).toHaveLength(6);
      expect(taskWithAssignee).toHaveLength(5);
    });
  });
});
