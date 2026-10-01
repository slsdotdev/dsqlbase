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
 * take any JSON value.
 */
describe("json columns", () => {
  const { getClient, getData } = withSeededClient();

  type BoardInput = {
    config?: { kind: "kanban" | "list"; columns?: number; since?: unknown };
    payload?: unknown;
    notes?: unknown;
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
      expect(() => jsonb("c").schema(schema)["_codec"].encode("a,b")).toThrow(
        ColumnValidationError
      );
    });

    it("refuses an async refinement", () => {
      const schema = z.string().refine(async () => true);

      expect(() => jsonb("c").schema(schema)["_codec"].encode("a")).toThrow(
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

    it("refuses any other operator, and a bare value, before SQL runs", () => {
      const client = getClient() as unknown as {
        boards: { findMany: (args: object) => unknown };
      };

      expect(() => client.boards.findMany({ where: { payload: { eq: { a: 1 } } } })).toThrow(
        'Operator "eq" is not valid on the json column "payload" of "boards"'
      );
      expect(() => client.boards.findMany({ where: { config: { kind: "kanban" } } })).toThrow(
        'Filter the json column "config" of "boards" with one of its operators'
      );
      expect(() => client.boards.findMany({ orderBy: { notes: "asc" } })).toThrow(
        'Cannot order by the json column "notes" of "boards".'
      );
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
        safeOperations: true,
      });

      expect(column?.data_type).toBe("jsonb");
      expect(plan.errors).toEqual([]);
      expect(plan.operations.filter((op) => op.type !== "DROP")).toEqual([]);
    });
  });
});
