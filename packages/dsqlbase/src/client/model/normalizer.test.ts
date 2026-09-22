import { beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnDefinition, type Session, type SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { bigint, date, datetime, duration, table, text, uuid } from "../../schema/index.js";

const events = table("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  day: date("day"),
  at: datetime("at"),
  span: duration("span", { mode: "iso" }),
  size: bigint("size"),
});

const schema = { events };

const DAY = new Date("2026-05-01T00:00:00.000Z");
const AT = new Date("2026-01-02T03:04:05.000Z");

describe("RequestNormalizer where clauses", () => {
  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
  });

  const params = () => calls[0]?.params;
  const text_ = () => calls[0]?.text ?? "";

  // A `date` column stores "2026-05-01"; a filter that sent a JS Date object relied on the
  // driver to serialize it the same way. Encoding through the column's codec makes the
  // filter match what the column actually wrote.
  describe("comparison operators encode through the column codec", () => {
    it.each([
      ["eq", { day: { eq: DAY } }],
      ["neq", { day: { neq: DAY } }],
      ["gt", { day: { gt: DAY } }],
      ["gte", { day: { gte: DAY } }],
      ["lt", { day: { lt: DAY } }],
      ["lte", { day: { lte: DAY } }],
    ] as const)("%s", async (_op, where) => {
      await dsql.events.findMany({ where });
      expect(params()).toEqual(["2026-05-01"]);
    });

    it("in encodes every value", async () => {
      await dsql.events.findMany({ where: { day: { in: [DAY, new Date("2026-06-02T00:00:00Z")] } } });
      expect(params()).toEqual(["2026-05-01", "2026-06-02"]);
    });

    it("between encodes both bounds", async () => {
      await dsql.events.findMany({ where: { day: { between: [DAY, new Date("2026-06-02T00:00:00Z")] } } });
      expect(params()).toEqual(["2026-05-01", "2026-06-02"]);
      expect(text_()).toContain("BETWEEN");
    });

    it("the bare-value shorthand encodes", async () => {
      await dsql.events.findMany({ where: { day: DAY } });
      expect(params()).toEqual(["2026-05-01"]);
    });
  });

  describe("per column type", () => {
    it("datetime", async () => {
      await dsql.events.findMany({ where: { at: { gt: AT } } });
      expect(params()).toEqual(["2026-01-02T03:04:05.000Z"]);
    });

    it("bigint", async () => {
      await dsql.events.findMany({ where: { size: { eq: 9007199254740993n } } });
      expect(params()).toEqual(["9007199254740993"]);
    });

    it("duration", async () => {
      await dsql.events.findMany({ where: { span: { eq: "PT8H" } } });
      expect(params()).toEqual(["PT8H"]);
    });
  });

  // Pattern operators compare against a LIKE pattern, not a column value, so encoding them
  // would corrupt the pattern.
  describe("pattern operators stay raw", () => {
    it.each([
      ["beginsWith", { name: { beginsWith: "Al" } }, "Al%"],
      ["endsWith", { name: { endsWith: "ce" } }, "%ce"],
      ["contains", { name: { contains: "li" } }, "%li%"],
    ] as const)("%s", async (_op, where, expected) => {
      await dsql.events.findMany({ where });
      expect(params()).toEqual([expected]);
      expect(text_()).toContain("LIKE");
    });
  });

  describe("non-value conditions", () => {
    it("exists emits a null check with no parameter", async () => {
      await dsql.events.findMany({ where: { day: { exists: false } } });
      expect(params()).toEqual([]);
      expect(text_()).toContain("IS NULL");
    });
  });

  describe("mutations", () => {
    it("encodes update.where", async () => {
      await dsql.events.update({ set: { name: "x" }, where: { day: { eq: DAY } } });
      expect(params()).toEqual(["x", "2026-05-01"]);
    });

    it("encodes delete.where", async () => {
      await dsql.events.delete({ where: { day: { eq: DAY } } });
      expect(params()).toEqual(["2026-05-01"]);
    });
  });

  // The built-in `pg` / PGlite drivers happen to coerce JS Dates and BigInts themselves, so
  // the columns above would also have worked unencoded. A codec that rewrites the value is
  // the case that cannot work without this — and the one `guid` columns will rely on.
  it("encodes a codec that rewrites the value", async () => {
    const calls: SQLStatement[] = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    const prefixed = table("prefixed", {
      id: new ColumnDefinition("id", {
        dataType: "text",
        codec: {
          encode: (value: string) => value.replace(/^id_/, ""),
          decode: (value: string) => `id_${value}`,
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const client = createClient({ schema: { prefixed }, session });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).prefixed.findMany({ where: { id: { eq: "id_42" } } });

    expect(calls[0]?.params).toEqual(["42"]);
  });

});

describe("RequestNormalizer read-only columns", () => {
  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().readOnly(),
    number: text("number").notNull(),
  });

  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<{ invoices: typeof invoices }>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema: { invoices }, session });
  });

  // The field is not in `CreateValuesOf`, so it can only arrive through an untyped spread.
  // Dropping it keeps `create({ data: { ...input } })` working; refusing it would not.
  it("drops a read-only field from create data", async () => {
    await dsql.invoices.create({
      data: { number: "INV-1", workspaceId: "ws-1" } as { number: string },
    });

    expect(calls[0]?.params).toEqual(["INV-1"]);
    expect(calls[0]?.text).not.toContain("$2");
  });

  it("drops a read-only field from update set", async () => {
    await dsql.invoices.update({
      set: { number: "INV-2", workspaceId: "ws-2" } as { number: string },
      where: { number: { eq: "INV-1" } },
    });

    expect(calls[0]?.params).toEqual(["INV-2", "INV-1"]);
  });

  it("keeps a read-only column filterable, selectable and orderable", async () => {
    await dsql.invoices.findMany({
      select: { workspaceId: true },
      where: { workspaceId: { eq: "ws-1" } },
      orderBy: { workspaceId: "asc" },
    });

    expect(calls[0]?.text).toContain(`"workspace_id"`);
    expect(calls[0]?.params).toEqual(["ws-1"]);
  });
});
