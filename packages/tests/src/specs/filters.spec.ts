import { describe, expect, it } from "vitest";
import { withSeededClient } from "../fixures/seeded-client.js";

/**
 * Story 7: `where` values are encoded by the column's codec before they reach the driver.
 * These specs run against real Postgres, so they check the encoded form actually matches
 * what the column wrote — not just what the normalizer produced.
 */
describe("filters on codec columns", () => {
  const { getClient } = withSeededClient();

  describe("date", () => {
    it("matches a date by equality", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true, dueDate: true },
        where: { dueDate: { eq: new Date("2026-05-01T00:00:00.000Z") } },
      });

      expect(rows.map((r) => r.title)).toEqual(["Setup authentication"]);
    });

    it("matches a date with the bare-value shorthand", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true },
        where: { dueDate: new Date("2026-06-01T00:00:00.000Z") },
      });

      expect(rows.map((r) => r.title)).toEqual(["Write API documentation"]);
    });

    it("matches dates with in", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true },
        where: {
          dueDate: {
            in: [new Date("2026-05-01T00:00:00.000Z"), new Date("2026-06-01T00:00:00.000Z")],
          },
        },
        orderBy: { title: "asc" },
      });

      expect(rows.map((r) => r.title)).toEqual(["Setup authentication", "Write API documentation"]);
    });

    it("matches dates with between", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true },
        where: {
          dueDate: {
            between: [new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z")],
          },
        },
        orderBy: { title: "asc" },
      });

      expect(rows.map((r) => r.title)).toEqual(["Setup authentication", "User settings page"]);
    });
  });

  describe("datetime", () => {
    it("compares a timestamp with gt", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true },
        where: { completedAt: { gt: new Date("2026-04-01T00:00:00.000Z") } },
      });

      expect(rows.map((r) => r.title)).toEqual(["Button component"]);
    });

    it("round-trips a value read back from a row", async () => {
      const client = getClient();

      const one = await client.tasks.findOne({
        select: { title: true, completedAt: true },
        where: { title: { eq: "Dashboard layout" } },
      });

      expect(one?.completedAt).toBeInstanceOf(Date);

      const again = await client.tasks.findMany({
        select: { title: true },
        where: { completedAt: { eq: one?.completedAt ?? new Date(0) } },
      });

      expect(again.map((r) => r.title)).toEqual(["Dashboard layout"]);
    });
  });

  describe("bigint", () => {
    it("matches a value beyond Number.MAX_SAFE_INTEGER", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true, estimateSeconds: true },
        where: { estimateSeconds: { eq: 9007199254740993n } },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe("Setup authentication");
      expect(rows[0]?.estimateSeconds).toBe(9007199254740993n);
    });

    it("compares bigints with gt", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true },
        where: { estimateSeconds: { gt: 3600n } },
        orderBy: { title: "asc" },
      });

      expect(rows.map((r) => r.title)).toEqual([
        "Button component",
        "Dashboard layout",
        "Setup authentication",
      ]);
    });
  });

  describe("duration", () => {
    it("matches an interval by equality", async () => {
      const client = getClient();

      const rows = await client.projects.findMany({
        select: { name: true, budgetHours: true },
        where: { budgetHours: { eq: "PT8H" } },
      });

      expect(rows.map((r) => r.name)).toEqual(["API Platform"]);
    });
  });

  describe("pattern operators are unaffected", () => {
    it("still matches with beginsWith", async () => {
      const client = getClient();

      const rows = await client.tasks.findMany({
        select: { title: true },
        where: { title: { beginsWith: "Setup" } },
      });

      expect(rows.map((r) => r.title)).toEqual(["Setup authentication"]);
    });
  });
});
