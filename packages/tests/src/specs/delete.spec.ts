import { describe, expect, it } from "vitest";
import { withSeededClient } from "../db/index.js";

describe("delete operations", () => {
  const { getClient, getData } = withSeededClient();

  describe("delete by primary key", () => {
    it("removes the row", async () => {
      const client = getClient();
      const data = getData();

      await client.users.delete({
        where: { id: { eq: data.users[0].id } },
      });

      const fetched = await client.users.findOne({
        where: { id: { eq: data.users[0].id } },
      });

      expect(fetched).toBeNull();
    });
  });

  describe("delete with multi-row matches", () => {
    it("removes every row matching the predicate", async () => {
      const client = getClient();

      await client.tasks.delete({
        where: { status: { eq: "done" } },
      });

      const remaining = await client.tasks.findMany({
        where: { status: { eq: "done" } },
      });
      const all = await client.tasks.findMany({});

      expect(remaining).toHaveLength(0);
      expect(all).toHaveLength(4);
    });

    it("matches via composite `and` / `or` filters", async () => {
      const client = getClient();

      await client.tasks.delete({
        where: {
          or: [{ priority: { eq: "low" } }, { dueDate: { exists: false } }],
        },
      });

      const remaining = await client.tasks.findMany({});

      for (const task of remaining) {
        expect(task.priority).not.toBe("low");
        expect(task.dueDate).not.toBeNull();
      }
    });
  });

  describe("delete with zero matches", () => {
    it("does not throw and leaves the table unchanged", async () => {
      const client = getClient();

      const before = await client.users.findMany({});

      await expect(
        client.users.delete({
          where: { id: { eq: "00000000-0000-0000-0000-000000000000" } },
        })
      ).resolves.not.toThrow();

      const after = await client.users.findMany({});
      expect(after).toHaveLength(before.length);
    });
  });

  describe("return projection", () => {
    it("`return: true` returns one of the deleted rows", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.delete({
        where: { id: { eq: data.users[0].id } },
        return: true,
      });

      expect(result).toMatchObject({
        id: data.users[0].id,
        name: data.users[0].name,
        email: data.users[0].email,
      });
    });

    it("`return: { … }` returns only the requested fields", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.delete({
        where: { id: { eq: data.users[1].id } },
        return: { id: true, email: true },
      });

      expect(result).toEqual({
        id: data.users[1].id,
        email: data.users[1].email,
      });
    });
  });

  describe("foreign-key behaviour", () => {
    it("leaves child rows in place when a parent is deleted (no FKs declared on this schema)", async () => {
      const client = getClient();
      const data = getData();

      const apiProject = data.projects[0];
      const childCountBefore = (
        await client.tasks.findMany({ where: { projectId: { eq: apiProject.id } } })
      ).length;

      await client.projects.delete({
        where: { id: { eq: apiProject.id } },
      });

      const orphans = await client.tasks.findMany({
        where: { projectId: { eq: apiProject.id } },
      });

      expect(childCountBefore).toBeGreaterThan(0);
      expect(orphans).toHaveLength(childCountBefore);
    });
  });
});
