import { describe, expect, it } from "vitest";
import { sql } from "@dsqlbase/core";
import { withSeededClient } from "../fixures/seeded-client";

/**
 * A relation named in `select` reads exactly as the same relation in `join`. Each spec runs
 * both forms against the same rows and compares them whole, so any difference in SQL,
 * correlation or result shaping shows up as data.
 */
describe("relations in select", () => {
  const { getClient, getData } = withSeededClient();

  /** Has-many arrays carry no order of their own here; sort them so the comparison is exact. */
  const byId = <T extends { id?: unknown }>(rows: T[]) =>
    [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  it("reads a belongs-to as the join form", async () => {
    const client = getClient();

    const selected = await client.tasks.findMany({
      select: { id: true, title: true, project: { name: true } },
      orderBy: { id: "asc" },
    });
    const joined = await client.tasks.findMany({
      select: { id: true, title: true },
      join: { project: { select: { name: true } } },
      orderBy: { id: "asc" },
    });

    expect(selected).toEqual(joined);
    expect(selected.some((task) => task.project?.name)).toBe(true);
  });

  it("reads a has-many as the join form", async () => {
    const client = getClient();

    const selected = await client.projects.findMany({
      select: { id: true, name: true, tasks: { id: true, title: true } },
      orderBy: { id: "asc" },
    });
    const joined = await client.projects.findMany({
      select: { id: true, name: true },
      join: { tasks: { select: { id: true, title: true } } },
      orderBy: { id: "asc" },
    });

    const sorted = (rows: typeof selected) => rows.map((p) => ({ ...p, tasks: byId(p.tasks) }));

    expect(sorted(selected)).toEqual(sorted(joined));
    expect(selected.flatMap((p) => p.tasks)).toHaveLength(getData().tasks.length);
  });

  it("nests three levels: user → tasks → project", async () => {
    const client = getClient();
    const user = getData().users[0];

    const selected = await client.users.findOne({
      where: { id: { eq: user.id } },
      select: { name: true, tasks: { id: true, title: true, project: { name: true } } },
    });
    const joined = await client.users.findOne({
      where: { id: { eq: user.id } },
      select: { name: true },
      join: {
        tasks: { select: { id: true, title: true }, join: { project: { select: { name: true } } } },
      },
    });

    expect(selected && { ...selected, tasks: byId(selected.tasks) }).toEqual(
      joined && { ...joined, tasks: byId(joined.tasks) }
    );
  });

  it("follows a self-referential relation", async () => {
    const client = getClient();

    const selected = await client.tasks.findMany({
      select: { id: true, parent: { id: true, title: true } },
      orderBy: { id: "asc" },
    });
    const joined = await client.tasks.findMany({
      select: { id: true },
      join: { parent: { select: { id: true, title: true } } },
      orderBy: { id: "asc" },
    });

    expect(selected).toEqual(joined);
    // A parent is another task, never the row itself.
    expect(selected.every((task) => task.parent?.id !== task.id)).toBe(true);
  });

  it("reads a relation to a union by its shared fields", async () => {
    const client = getClient();

    const selected = await client.authors.findMany({
      select: { id: true, posts: { id: true, createdAt: true } },
      orderBy: { id: "asc" },
    });
    const joined = await client.authors.findMany({
      select: { id: true },
      join: { posts: { select: { id: true, createdAt: true } } },
      orderBy: { id: "asc" },
    });

    expect(selected).toEqual(joined);
    expect(selected.flatMap((a) => a.posts.map((post) => post.$$key)).sort()).toContain("videos");
  });

  it("returns only the relations when select names no column", async () => {
    const client = getClient();

    const tasks = await client.tasks.findMany({ select: { project: { name: true } } });

    expect(tasks).toHaveLength(getData().tasks.length);
    expect(tasks.every((task) => Object.keys(task).sort().join() === "$$meta,project")).toBe(true);
  });

  it("returns every column when select names nothing", async () => {
    const client = getClient();

    const all = await client.users.findMany({ orderBy: { id: "asc" } });
    const empty = await client.users.findMany({ select: {}, orderBy: { id: "asc" } });
    const unselected = await client.users.findMany({
      select: { id: false, membership: false },
      orderBy: { id: "asc" },
    });

    expect(empty).toEqual(all);
    expect(unselected).toEqual(all);
    expect(all[0]).toHaveProperty("email");
  });

  it("refuses a relation in both select and join before anything runs", () => {
    const client = getClient() as unknown as {
      tasks: { findMany: (args: object) => unknown };
    };

    expect(() =>
      client.tasks.findMany({ select: { project: true }, join: { project: true } })
    ).toThrow('Relation "project" appears in both select and join on "tasks"');
  });

  // A joined row is read through `row_to_json`; a bigint must not come back as a rounded double.
  describe("exact numbers in joined rows", () => {
    const exact = 9007199254740993n; // 2^53 + 1: the first integer a double can't hold

    it("keeps a bigint exact through a belongs-to and a has-many", async () => {
      const client = getClient();
      await client.$query(sql`UPDATE "tasks" SET "estimate_seconds" = ${exact.toString()}::bigint`);

      const [child] = await client.tasks.findMany({
        where: { parentId: { exists: true } },
        select: { id: true, parent: { estimateSeconds: true } },
        limit: 1,
      });
      const parent = await client.tasks.findOne({
        // The seed makes tasks 2 and 3 children of task 1.
        where: { id: { eq: getData().tasks[0]?.id ?? "" } },
        select: { id: true, subtasks: { estimateSeconds: true } },
      });

      expect(child?.parent?.estimateSeconds).toBe(exact);
      expect(parent?.subtasks.length).toBeGreaterThan(0);
      expect(parent?.subtasks.every((task) => task.estimateSeconds === exact)).toBe(true);
    });
  });
});
