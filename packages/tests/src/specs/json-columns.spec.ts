import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ColumnValidationError } from "dsqlbase";
import { jsonb } from "dsqlbase/schema";
import { createMigrationRunner } from "@dsqlbase/migration";
import { withSeededClient } from "../fixures/seeded-client";
import { schema } from "../db/schema";

/**
 * `jsonb` / `json` columns against a real database: what is stored, what reads back, and what
 * a zod schema on the column refuses. `boards.config` is validated by
 * `{ kind: enum, columns: int = 3, since?: coerce.date }`; `payload` (jsonb) and `notes` (json)
 * take any JSON value; `labels` is an `array()` of strings, `limits` a `record()` of numbers.
 */
describe("json columns", () => {
  const { getClient, getData } = withSeededClient();

  type BoardInput = {
    config?: { kind: "kanban" | "list"; columns?: number; since?: unknown };
    payload?: unknown;
    notes?: unknown;
    labels?: string[] | null;
    limits?: Record<string, number> | null;
  };

  const createBoard = (data: BoardInput = {}) =>
    getClient().boards.create({
      data: {
        projectId: getData().projects[0].id,
        name: "Board",
        config: { kind: "kanban" },
        ...data,
      },
      return: { id: true },
    });

  /** The columns as the database holds them, bypassing every codec. */
  const stored = async (id: string | undefined) => {
    const [row] = await getClient().$execute<Record<string, unknown>>({
      text: `SELECT config::text AS config, jsonb_typeof(payload) AS payload_type, payload::text AS payload, notes::text AS notes FROM boards WHERE id = $1`,
      params: [id],
    });

    return row;
  };

  describe("any JSON value", () => {
    it.each([
      ["an object", { a: [1, { b: null }] }, "object"],
      ["an array", ["x", 2, true], "array"],
      ["a string that looks like a number", "123", "string"],
      ["a string that looks like a boolean", "true", "string"],
      ["a number", 42.5, "number"],
      ["a boolean", false, "boolean"],
    ])("round-trips %s", async (_, value, type) => {
      const board = await createBoard({ payload: value, notes: value });

      const read = await getClient().boards.findOne({ where: { id: { eq: board?.id } } });

      expect(read?.payload).toEqual(value);
      expect(read?.notes).toEqual(value);
      expect((await stored(board?.id))?.payload_type).toBe(type);
    });

    it("stores null as SQL NULL", async () => {
      const board = await createBoard({ payload: null });

      expect((await stored(board?.id))?.payload_type).toBeNull();
      expect(
        await getClient().boards.count({ where: { payload: { exists: false } } })
      ).toBeGreaterThan(0);
    });
  });

  describe("with a zod schema", () => {
    it("stores the schema's output, the default filled and the date coerced", async () => {
      const board = await createBoard({ config: { kind: "list", since: "2026-10-01" } });

      expect(JSON.parse(String((await stored(board?.id))?.config))).toEqual({
        kind: "list",
        columns: 3,
        since: "2026-10-01T00:00:00.000Z",
      });
    });

    it("reads the schema's output, through a join as at the root", async () => {
      const board = await createBoard({ config: { kind: "list", since: "2026-10-01" } });

      const read = await getClient().boards.findOne({ where: { id: { eq: board?.id } } });
      const project = await getClient().projects.findOne({
        where: { id: { eq: getData().projects[0].id } },
        select: { boards: { config: true } },
      });

      expect(read?.config.since).toBeInstanceOf(Date);
      expect(read?.config.columns).toBe(3);
      expect(project?.boards[0]?.config).toEqual(read?.config);
    });

    it("refuses an invalid write before any row is written", async () => {
      // @ts-expect-error not a kind: the runtime refuses it as the types do
      expect(() => createBoard({ config: { kind: "grid" } })).toThrow(ColumnValidationError);
      expect(() =>
        getClient().boards.update({
          where: { name: "Board" },
          // A number to the types; only the schema knows it must be positive.
          set: { config: { kind: "list", columns: -1 } },
        })
      ).toThrow('Invalid value for column "config" on write: columns:');
      expect(await getClient().boards.count({})).toBe(0);
    });

    it("fails a read of a stored row the schema refuses", async () => {
      const board = await createBoard();

      await getClient().$execute({
        text: `UPDATE boards SET config = '{"kind":"grid"}' WHERE id = $1`,
        params: [board?.id],
      });

      await expect(getClient().boards.findMany({})).rejects.toThrow(
        expect.objectContaining({ code: "invalid", column: "config", phase: "read" })
      );
    });
  });

  // A transform cannot be stored: its output does not read back as itself.
  describe("a zod schema the column refuses", () => {
    it.each([
      ["a type-changing transform", z.string().transform((s) => s.split(","))],
      ["a value-changing transform", z.string().transform((s) => `${s}!`)],
    ])("refuses %s on the first write", (_, schema) => {
      expect(() => jsonb("c").schema(schema)["_validator"]?.write("a,b")).toThrow(
        ColumnValidationError
      );
    });

    it("refuses an async refinement", () => {
      const schema = z.string().refine(async () => true);

      expect(() => jsonb("c").schema(schema)["_validator"]?.write("a")).toThrow(
        expect.objectContaining({ code: "async" })
      );
    });
  });

  describe("filters", () => {
    it("filters by exists", async () => {
      await createBoard({ payload: { a: 1 } });
      await createBoard();

      expect(await getClient().boards.count({ where: { payload: { exists: true } } })).toBe(1);
    });

    it("matches a jsonb fragment with contains, at any depth", async () => {
      await createBoard({ payload: { a: { b: 1, c: 2 }, tags: ["x", "y"] } });
      await createBoard({ payload: { a: { b: 2 } } });
      await createBoard({ payload: ["x", { id: 1, name: "n" }] });

      const count = (contains: unknown) =>
        getClient().boards.count({ where: { payload: { contains } } });

      expect(await count({ a: { b: 1 } })).toBe(1);
      expect(await count({ tags: ["y"] })).toBe(1);
      expect(await count([{ id: 1 }])).toBe(1);
      expect(await count({ a: {} })).toBe(2);
      expect(await count({ a: { b: 3 } })).toBe(0);
    });

    it("compares whole jsonb documents with eq and neq", async () => {
      await createBoard({ payload: { a: 1, b: [1, 2] } });
      await createBoard({ payload: [2, 1] });

      const count = (filter: object) => getClient().boards.count({ where: { payload: filter } });

      // Object keys compare in any order; array items in order.
      expect(await count({ eq: { b: [1, 2], a: 1 } })).toBe(1);
      expect(await count({ eq: [1, 2] })).toBe(0);
      expect(await count({ neq: [2, 1] })).toBe(1);
    });

    it("sends a fragment as given, not through the column's schema", async () => {
      await createBoard({ config: { kind: "list" } });

      // The schema would refuse a config without a kind, and fill in columns: 3.
      expect(
        await getClient().boards.count({ where: { config: { contains: { columns: 3 } } } })
      ).toBe(1);
    });

    it("compares a jsonb column under distinct", async () => {
      await createBoard({ payload: { a: 1 } });
      await createBoard({ payload: { a: 1 } });

      const rows = await getClient().boards.findMany({
        distinct: true,
        select: { payload: true },
      });

      expect(rows.map((row) => row.payload)).toEqual([{ a: 1 }]);
    });

    it("refuses any other operator, and a bare value, before SQL runs", () => {
      const client = getClient() as unknown as {
        boards: { findMany: (args: object) => unknown };
      };

      expect(() => client.boards.findMany({ where: { notes: { eq: { a: 1 } } } })).toThrow(
        'Operator "eq" is not valid on the json column "notes" of "boards"'
      );
      expect(() => client.boards.findMany({ where: { payload: { gt: 1 } } })).toThrow(
        'Operator "gt" is not valid on the jsonb column "payload" of "boards"'
      );
      expect(() => client.boards.findMany({ where: { config: { kind: "kanban" } } })).toThrow(
        'Filter the jsonb column "config" of "boards" with one of its operators'
      );
      expect(() => client.boards.findMany({ orderBy: { notes: "asc" } })).toThrow(
        'Cannot order by the json column "notes" of "boards".'
      );
    });
  });

  describe("array() and record()", () => {
    const read = async (id: string | undefined) =>
      getClient().boards.findOne({
        where: { id: { eq: id } },
        select: { labels: true, limits: true },
      });

    // The text-backed array() lost both.
    it("round-trips items with commas, and an empty array, as jsonb", async () => {
      const withComma = await createBoard({ labels: ["a,b", "c"], limits: { cpu: 2 } });
      const empty = await createBoard({ labels: [], limits: {} });

      expect(await read(withComma?.id)).toMatchObject({ labels: ["a,b", "c"], limits: { cpu: 2 } });
      expect(await read(empty?.id)).toMatchObject({ labels: [], limits: {} });

      const [types] = await getClient().$execute<Record<string, unknown>>({
        text: `SELECT jsonb_typeof(labels) AS labels, jsonb_typeof(limits) AS limits FROM boards WHERE id = $1`,
        params: [withComma?.id],
      });
      expect(types).toEqual({ labels: "array", limits: "object" });
    });

    it("refuses a value of the wrong shape on write, and the record's schema too", () => {
      const client = getClient() as unknown as {
        boards: { create: (args: object) => unknown };
      };
      const write = (data: object) =>
        client.boards.create({
          data: {
            projectId: getData().projects[0].id,
            name: "Board",
            config: { kind: "list" },
            ...data,
          },
        });

      expect(() => write({ labels: "a,b" })).toThrow(
        'Invalid value for column "labels" on write: Expected an array'
      );
      expect(() => write({ limits: [1] })).toThrow(ColumnValidationError);
      expect(() => write({ limits: { cpu: "two" } })).toThrow(
        expect.objectContaining({ code: "invalid", column: "limits", phase: "write" })
      );
    });

    it("fails a read of a stored value of the wrong shape", async () => {
      const board = await createBoard();

      await getClient().$execute({
        text: `UPDATE boards SET labels = '"a,b"' WHERE id = $1`,
        params: [board?.id],
      });

      await expect(read(board?.id)).rejects.toThrow(
        'Invalid value for column "labels" on read: Expected an array'
      );
    });

    it("filters an array by contains: every given item, in any order", async () => {
      await createBoard({ labels: ["a", "b", "c"] });
      await createBoard({ labels: ["b"] });
      await createBoard({ labels: [] });

      const count = (contains: string[]) =>
        getClient().boards.count({ where: { labels: { contains } } });

      expect(await count(["c", "a"])).toBe(1);
      expect(await count(["b"])).toBe(2);
      expect(await count([])).toBe(3);
      expect(
        await getClient().boards.count({
          where: { or: [{ labels: { contains: ["c"] } }, { labels: { eq: ["b"] } }] },
        })
      ).toBe(2);
    });

    it("compares an array with eq, in order", async () => {
      await createBoard({ labels: ["a", "b"] });

      const count = (eq: string[]) => getClient().boards.count({ where: { labels: { eq } } });

      expect(await count(["a", "b"])).toBe(1);
      expect(await count(["b", "a"])).toBe(0);
    });

    it("filters a record by a fragment, and by key", async () => {
      await createBoard({ limits: { cpu: 2, memory: 512 } });
      await createBoard({ limits: { memory: 256 } });

      const count = (filter: object) => getClient().boards.count({ where: { limits: filter } });

      expect(await count({ contains: { cpu: 2 } })).toBe(1);
      expect(await count({ hasKey: "memory" })).toBe(2);
      expect(await count({ hasKey: "disk" })).toBe(0);
      expect(await count({ hasKey: "memory", contains: { memory: 256 } })).toBe(1);
    });
  });

  describe("migrations", () => {
    it("creates a jsonb column, and finds nothing to change in it on a re-run", async () => {
      const [column] = await getClient().$execute<{ data_type: string }>({
        text: `SELECT data_type FROM information_schema.columns WHERE table_name = 'boards' AND column_name = $1`,
        params: ["config"],
      });
      // Planned alone, so the rest of the fixture appears only as drops and every error or
      // change left is about boards.
      const plan = await createMigrationRunner(getClient().session).plan([schema.boards.toJSON()], {
        asyncIndexes: false,
        ifExists: true,
      });

      expect(column?.data_type).toBe("jsonb");
      expect(plan.errors).toEqual([]);
      expect(plan.operations.filter((op) => op.type !== "DROP")).toEqual([]);
    });
  });
});
