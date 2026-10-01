import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import {
  array,
  boolean,
  bytea,
  int,
  interval,
  json,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";

const docs = table("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  pages: int("pages"),
  draft: boolean("draft"),
  body: bytea("body"),
  settings: json("settings"),
  tags: array("tags"),
  ttl: interval("ttl"),
});

const notes = table("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  settings: json("settings"),
});

const items = union({ docs, notes });

const schema = { docs, notes, items };

/**
 * Filters, `orderBy` and `distinct` follow the column's runtime type (`operators.ts`). The
 * calls the types refuse are cast through `any`: they test the runtime, which enforces the same
 * rules for a caller the types cannot see — a resolver passing arguments through.
 */
describe("filters by runtime type", () => {
  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<typeof schema>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loose: any;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema, session });
    loose = dsql;
  });

  const where = async (filter: object) => {
    await loose.docs.findMany({ select: { id: true }, where: filter });

    return calls.at(-1)?.text.replace(/^.* WHERE /, "");
  };

  describe("operators", () => {
    it("applies every operator of one column's filter, AND-ed", async () => {
      expect(await where({ pages: { gte: 1, lte: 5 } })).toBe(
        '"__t0"."pages" >= $1 AND "__t0"."pages" <= $2'
      );
    });

    it("keeps the pattern operators on string columns", async () => {
      expect(await where({ title: { contains: "x" } })).toBe('"__t0"."title" LIKE $1');
    });

    it("skips an operator set to undefined", async () => {
      expect(await where({ pages: { gt: undefined, lt: 3 } })).toBe('"__t0"."pages" < $1');
    });

    it("refuses an operator the column's runtime type does not have", async () => {
      await expect(where({ id: { contains: "x" } })).rejects.toThrow(
        'Operator "contains" is not valid on the uuid column "id" of "docs" ' +
          "(valid: eq, neq, in, gt, gte, lt, lte, between, exists)."
      );
      await expect(where({ draft: { gt: true } })).rejects.toThrow(
        'Operator "gt" is not valid on the boolean column "draft"'
      );
      expect(calls).toHaveLength(0);
    });

    it("refuses an operator no runtime type has", async () => {
      await expect(where({ pages: { eq: 1, near: 2 } })).rejects.toThrow(
        'Unknown operator "near" in the filter on the number column "pages" of "docs".'
      );
    });

    it("reserves `where` for filtering into a value", async () => {
      await expect(where({ settings: { where: { theme: { eq: "dark" } } } })).rejects.toThrow(
        'A nested `where` on the json column "settings" of "docs" is not supported yet.'
      );
    });
  });

  describe("value shorthand", () => {
    it("means eq where the runtime type takes one", async () => {
      expect(await where({ title: "a" })).toBe('"__t0"."title" = $1');
    });

    it("takes a plain-object value that names no operator, as an interval's Duration", async () => {
      expect(await where({ ttl: { hours: 1 } })).toBe('"__t0"."ttl" = $1');
    });

    it.each([
      ["json", { settings: { theme: "dark" } }, "settings"],
      ["json", { settings: "dark" }, "settings"],
      ["bytes", { body: new Uint8Array([1]) }, "body"],
      ["array", { tags: ["a"] }, "tags"],
    ])("is refused on a %s column", async (runtimeType, filter, field) => {
      await expect(where(filter)).rejects.toThrow(
        `Filter the ${runtimeType} column "${field}" of "docs" with one of its operators ` +
          "(exists), not a bare value."
      );
    });
  });

  describe("json columns", () => {
    it("filter by exists", async () => {
      expect(await where({ settings: { exists: true } })).toBe('"__t0"."settings" IS NOT NULL');
      expect(await where({ settings: { exists: false } })).toBe('"__t0"."settings" IS NULL');
    });

    it.each(["eq", "contains", "beginsWith", "gt"])("refuse %s", async (operator) => {
      await expect(where({ settings: { [operator]: "x" } })).rejects.toThrow(
        `Operator "${operator}" is not valid on the json column "settings" of "docs" ` +
          "(valid: exists)."
      );
    });

    it("are refused inside and / or / not, as at the top", async () => {
      await expect(where({ or: [{ settings: { eq: "x" } }] })).rejects.toThrow(
        'Operator "eq" is not valid on the json column "settings"'
      );
    });

    it("cannot be ordered by", async () => {
      expect(() => loose.docs.findMany({ orderBy: { settings: "asc" } })).toThrow(
        'Cannot order by the json column "settings" of "docs".'
      );
      expect(() => loose.docs.paginate({ orderBy: { body: "asc" } })).toThrow(
        'Cannot order by the bytes column "body" of "docs".'
      );
    });

    it("cannot be compared by distinct, selected or implied", () => {
      expect(() => loose.docs.findMany({ distinct: true })).toThrow(
        '`distinct` cannot compare the json column "settings" of "docs"'
      );
      expect(() =>
        loose.docs.findMany({ distinct: true, select: { id: true, settings: true } })
      ).toThrow('`distinct` cannot compare the json column "settings"');
    });

    it("leave distinct alone when not selected", async () => {
      await dsql.docs.findMany({ distinct: true, select: { title: true } });

      expect(calls[0]?.text).toMatch(/^SELECT DISTINCT/);
    });
  });

  describe("across a union", () => {
    it("checks a shared field's filter against each member's column", () => {
      expect(() => loose.items.findMany({ where: { settings: { eq: "x" } } })).toThrow(
        'Operator "eq" is not valid on the json column "settings"'
      );
    });

    it("cannot order by a shared json field", () => {
      expect(() => loose.items.findMany({ orderBy: { settings: "desc" } })).toThrow(
        'Cannot order by the json field "settings" of union "items".'
      );
    });
  });
});
