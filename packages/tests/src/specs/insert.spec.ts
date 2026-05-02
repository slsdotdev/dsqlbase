import { describe, expect, it } from "vitest";
import { withSeededClient } from "../fixures/seeded-client";

describe("insert operations", () => {
  const { getClient, getData } = withSeededClient();

  describe("create", () => {
    it("inserts with only required fields and applies column defaults", async () => {
      const client = getClient();

      await client.users.create({
        data: { name: "Eve Adams", email: "eve@example.com" },
      });

      const fetched = await client.users.findOne({
        where: { email: { eq: "eve@example.com" } },
      });

      expect(fetched?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(fetched?.createdAt).toBeInstanceOf(Date);
      expect(fetched?.updatedAt).toBeInstanceOf(Date);
    });

    it("applies boolean column defaults", async () => {
      const client = getClient();

      await client.teams.create({
        data: { name: "Operations", slug: "operations" },
      });

      const fetched = await client.teams.findOne({
        where: { slug: { eq: "operations" } },
      });

      expect(fetched?.isActive).toBe(true);
    });
  });

  describe("return projection", () => {
    it("`return: true` returns the full inserted row", async () => {
      const client = getClient();

      const result = await client.users.create({
        data: { name: "Frank Castle", email: "frank@example.com" },
        return: true,
      });

      expect(result).toMatchObject({
        name: "Frank Castle",
        email: "frank@example.com",
      });
      expect(result?.id).toEqual(expect.any(String));
      expect(result?.createdAt).toBeInstanceOf(Date);
    });

    it("`return: { … }` returns only the requested fields", async () => {
      const client = getClient();

      const result = await client.users.create({
        data: { name: "Gina Torres", email: "gina@example.com" },
        return: { id: true, email: true },
      });

      expect(result).toEqual({
        id: expect.any(String),
        email: "gina@example.com",
      });
    });
  });

  describe("column type round-trips", () => {
    it("`json` round-trips via JSON.stringify/parse codec", async () => {
      const client = getClient();
      const data = getData();

      await client.projects.create({
        data: {
          teamId: data.teams[0].id,
          name: "Settings Test",
          key: "STG",
          settings: { notificationsEnabled: true, theme: "dark" },
        },
      });

      const fetched = await client.projects.findOne({
        where: { key: { eq: "STG" } },
      });

      expect(fetched?.settings).toEqual({ notificationsEnabled: true, theme: "dark" });
    });

    it("`domain` columns accept any allowed value", async () => {
      const client = getClient();
      const data = getData();

      for (const status of ["todo", "in_progress", "done", "archived"] as const) {
        await client.tasks.create({
          data: {
            projectId: data.projects[0].id,
            taskNumber: `D-${status}`,
            title: `Domain ${status}`,
            status,
            priority: "low",
          },
        });
      }

      const fetched = await client.tasks.findMany({
        where: { taskNumber: { beginsWith: "D-" } },
        orderBy: { taskNumber: "asc" },
      });

      expect(fetched.map((t) => t.status).sort()).toEqual([
        "archived",
        "done",
        "in_progress",
        "todo",
      ]);
    });

    it("`date` and `datetime` round-trip as Date instances", async () => {
      const client = getClient();
      const data = getData();

      const due = new Date("2026-12-25");
      const completed = new Date("2026-11-30T15:45:00Z");

      const result = await client.tasks.create({
        data: {
          projectId: data.projects[0].id,
          taskNumber: "DATE-1",
          title: "Date round-trip",
          status: "done",
          priority: "low",
          dueDate: due,
          completedAt: completed,
        },
        return: true,
      });

      expect(result?.dueDate).toBeInstanceOf(Date);
      expect(result?.completedAt).toBeInstanceOf(Date);
      expect(result?.dueDate?.toISOString().slice(0, 10)).toBe("2026-12-25");
      expect(result?.completedAt?.getTime()).toBe(completed.getTime());
    });

    it("`duration` (interval) round-trips as ISO 8601 in iso mode", async () => {
      const client = getClient();
      const data = getData();

      await client.projects.create({
        data: {
          teamId: data.teams[0].id,
          name: "Duration Test",
          key: "DUR",
          budgetHours: "PT40H",
        },
      });

      const fetched = await client.projects.findOne({
        where: { key: { eq: "DUR" } },
      });

      expect(fetched?.budgetHours).toBe("PT40H");
    });

    it("nullable columns accept explicit null", async () => {
      const client = getClient();
      const data = getData();

      await client.tasks.create({
        data: {
          projectId: data.projects[0].id,
          assigneeId: null,
          taskNumber: "NULL-1",
          title: "Null fields",
          status: "todo",
          priority: "none",
          dueDate: null,
        },
      });

      const fetched = await client.tasks.findOne({
        where: { taskNumber: { eq: "NULL-1" } },
      });

      expect(fetched?.assigneeId).toBeNull();
      expect(fetched?.dueDate).toBeNull();
    });
  });

  describe("constraint violations surface as thrown errors", () => {
    it("rejects a duplicate value for a UNIQUE column", async () => {
      const client = getClient();
      const data = getData();

      await expect(
        client.users.create({
          data: { name: "Duplicate Alice", email: data.users[0].email },
        })
      ).rejects.toThrow();
    });

    it("rejects a domain CHECK violation", async () => {
      const client = getClient();
      const data = getData();

      await expect(
        client.tasks.create({
          data: {
            projectId: data.projects[0].id,
            taskNumber: "BAD-1",
            title: "Bad status",
            // @ts-expect-error — invalid domain value, runtime CHECK should reject
            status: "bogus",
            priority: "low",
          },
        })
      ).rejects.toThrow();
    });

    it("rejects when a NOT NULL column is missing", async () => {
      const client = getClient();
      const data = getData();

      await expect(
        client.tasks.create({
          // @ts-expect-error — `title` is required (not-null, no default)
          data: {
            projectId: data.projects[0].id,
            taskNumber: "BAD-2",
            status: "todo",
            priority: "low",
          },
        })
      ).rejects.toThrow();
    });
  });
});
