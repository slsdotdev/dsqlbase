import { describe, expect, it } from "vitest";
import { withSeededClient } from "../fixures/seeded-client";

describe("update operations", () => {
  const { getClient, getData } = withSeededClient();

  describe("update by primary key", () => {
    it("modifies a single row and persists the change", async () => {
      const client = getClient();
      const data = getData();

      await client.users.update({
        where: { id: { eq: data.users[0].id } },
        set: { name: "Alice Renamed" },
      });

      const fetched = await client.users.findOne({
        where: { id: { eq: data.users[0].id } },
      });

      expect(fetched?.name).toBe("Alice Renamed");
      expect(fetched?.email).toBe(data.users[0].email);
    });
  });

  describe("update with multi-row matches", () => {
    it("applies the change to every matching row", async () => {
      const client = getClient();
      const data = getData();

      const apiProject = data.projects[0];

      await client.tasks.update({
        where: { projectId: { eq: apiProject.id } },
        set: { priority: "urgent" },
      });

      const after = await client.tasks.findMany({
        where: { projectId: { eq: apiProject.id } },
      });

      expect(after).toHaveLength(3);
      for (const task of after) {
        expect(task.priority).toBe("urgent");
      }
    });

    it("matches via composite `and` / `or` filters", async () => {
      const client = getClient();

      await client.tasks.update({
        where: {
          and: [
            { status: { eq: "todo" } },
            { or: [{ priority: { eq: "low" } }, { priority: { eq: "medium" } }] },
          ],
        },
        set: { status: "archived" },
      });

      const archived = await client.tasks.findMany({
        where: { status: { eq: "archived" } },
      });
      const stillTodo = await client.tasks.findMany({
        where: { status: { eq: "todo" } },
      });

      expect(archived).toHaveLength(2);
      expect(stillTodo).toHaveLength(0);
    });
  });

  describe("update with zero matches", () => {
    it("does not throw and leaves the table unchanged", async () => {
      const client = getClient();

      const before = await client.users.findMany({});

      await expect(
        client.users.update({
          where: { id: { eq: "00000000-0000-0000-0000-000000000000" } },
          set: { name: "Phantom" },
        })
      ).resolves.not.toThrow();

      const after = await client.users.findMany({});
      expect(after).toHaveLength(before.length);
    });
  });

  describe("return projection", () => {
    it("`return: true` returns the updated row", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.update({
        where: { id: { eq: data.users[1].id } },
        set: { name: "Bob Updated" },
        return: true,
      });

      expect(result).toMatchObject({
        id: data.users[1].id,
        name: "Bob Updated",
      });
    });

    it("`return: { … }` returns only the requested fields", async () => {
      const client = getClient();
      const data = getData();

      const result = await client.users.update({
        where: { id: { eq: data.users[2].id } },
        set: { name: "Carol Updated" },
        return: { id: true, name: true },
      });

      expect(result).toEqual({
        id: data.users[2].id,
        name: "Carol Updated",
      });
    });
  });

  describe("mixed column-type updates", () => {
    it("updates `text`, `boolean`, `json`, `domain`, `date`, and nullable→null in one call each", async () => {
      const client = getClient();
      const data = getData();

      // seed order: projects[0] is API Platform; tasks[0] is its first task
      const apiProject = data.projects[0];
      const firstTask = data.tasks[0];

      await client.projects.update({
        where: { id: { eq: apiProject.id } },
        set: {
          name: "API Platform v2",
          isArchived: false,
          settings: { notificationsEnabled: false, theme: "light" },
        },
      });
      await client.tasks.update({
        where: { id: { eq: firstTask.id } },
        set: {
          status: "done",
          dueDate: new Date("2027-01-15"),
          assigneeId: null,
        },
      });

      const project = await client.projects.findOne({
        where: { id: { eq: apiProject.id } },
      });
      const task = await client.tasks.findOne({
        where: { id: { eq: firstTask.id } },
      });

      expect(project?.name).toBe("API Platform v2");
      expect(project?.isArchived).toBe(false);
      expect(project?.settings).toEqual({ notificationsEnabled: false, theme: "light" });
      expect(task?.status).toBe("done");
      expect(task?.dueDate).toBeInstanceOf(Date);
      expect(task?.dueDate?.toISOString().slice(0, 10)).toBe("2027-01-15");
      expect(task?.assigneeId).toBeNull();
    });
  });

  describe("constraint violations surface as thrown errors", () => {
    it("rejects an update that would create a duplicate UNIQUE value", async () => {
      const client = getClient();
      const data = getData();

      await expect(
        client.users.update({
          where: { id: { eq: data.users[0].id } },
          set: { email: data.users[1].email },
        })
      ).rejects.toThrow();
    });

    it("rejects an update that violates a domain CHECK", async () => {
      const client = getClient();
      const data = getData();

      await expect(
        client.tasks.update({
          where: { id: { eq: data.tasks[0].id } },
          // @ts-expect-error — invalid domain value, runtime CHECK should reject
          set: { status: "bogus" },
        })
      ).rejects.toThrow();
    });
  });
});
