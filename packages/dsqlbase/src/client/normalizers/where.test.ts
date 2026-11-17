import { describe, it, expect } from "vitest";
import { AnyTable, SchemaRegistry, sql } from "@dsqlbase/core";
import {
  table,
  text,
  int,
  boolean,
  bytea,
  json,
  jsonb,
  array,
  record,
  interval,
  guid,
  relations,
  hasMany,
  belongsTo,
} from "../../schema/index.js";
import { encodeGlobalId } from "../../schema/utils/global-id.js";
import { WhereBuilder } from "./where.js";
import { WhereExpressionOf } from "./base.js";

const docsTable = table("docs", {
  id: guid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  pages: int("pages"),
  draft: boolean("draft"),
  body: bytea("body"),
  settings: json("settings"),
  doc: jsonb("doc"),
  prefs: jsonb("prefs"),
  tags: array("tags"),
  limits: record("limits").$type<{ min: number; max: number }>(),
  ttl: interval("ttl"),
  userId: guid("userId"),
});

const usersTable = table("users", {
  id: guid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

const userRelations = relations(usersTable, {
  documents: hasMany(docsTable, {
    from: [usersTable.columns.id],
    to: [docsTable.columns.userId],
  }),
});

const docsRelations = relations(docsTable, {
  user: belongsTo(usersTable, {
    from: [docsTable.columns.userId],
    to: [usersTable.columns.id],
  }),
});

const registry = new SchemaRegistry({
  docs: docsTable,
  users: usersTable,
  userRelations,
  docsRelations,
});

const { docs } = registry.getTables();
const builder = new WhereBuilder();

const where = <T extends AnyTable>(table: T, where: WhereExpressionOf<T>) => {
  const clause = builder.build(table, where);
  return sql`${clause}`.toQuery();
};

describe("WhereBuilder", () => {
  describe("filter operators", () => {
    it("applies every operator of one column's filter, AND-ed", () => {
      expect(where(docs, { pages: { gte: 1, lte: 5 } }).text).toBe(
        '"docs"."pages" >= $1 AND "docs"."pages" <= $2'
      );
    });

    it("keeps the pattern operators on string columns", () => {
      expect(where(docs, { title: { contains: "x" } }).text).toBe('"docs"."title" LIKE $1');
    });

    it("skips an operator set to undefined", () => {
      expect(where(docs, { pages: { gt: undefined, lt: 3 } }).text).toBe('"docs"."pages" < $1');
    });

    it("refuses an operator the column's runtime type does not have", () => {
      // @ts-expect-error Testing invalid operator on uuid column
      expect(() => where(docs, { id: { contains: "x" } })).toThrow(
        'Operator "contains" is not valid on the uuid column "id" of "docs" ' +
          "(valid: eq, neq, in, exists)."
      );
      // @ts-expect-error Testing invalid operator on boolean column
      expect(() => where(docs, { draft: { gt: true } })).toThrow(
        'Operator "gt" is not valid on the boolean column "draft"'
      );
    });

    it("refuses an operator no runtime type has", () => {
      // @ts-expect-error Testing unknown operator on number column
      expect(() => where(docs, { pages: { eq: 1, near: 2 } })).toThrow(
        'Operator "near" is not valid on the number column "pages" of "docs" (valid: eq, neq, in, gt, gte, lt, lte, between, exists).'
      );
    });

    // An object naming no operator is a value only where values can be plain objects.
    it("refuses an object that names only unknown operators, where it can't be a value", () => {
      // @ts-expect-error Testing unknown operator on uuid column
      expect(() => where(docs, { id: { isNull: true } })).toThrow(
        'Unknown operator "isNull" in the filter on the uuid column "id" of "docs" ' +
          "(valid: eq, neq, in, exists)."
      );
    });

    // An interval's value is a `Duration`, itself a plain object.
    it("keeps an object with no operator as a value on an interval column", () => {
      // @ts-expect-error Testing object as value on interval column
      expect(where(docs, { ttl: { days: 1 } }).text).toBe('"docs"."ttl" = $1');
    });

    it("escapes LIKE wildcards in a pattern operator's value", async () => {
      expect(where(docs, { title: { beginsWith: "50%_off\\" } }).params).toEqual([
        "50\\%\\_off\\\\%",
      ]);
      expect(where(docs, { title: { contains: "a_b" } }).params).toEqual(["%a\\_b%"]);
    });

    it("renders in: [] as matching nothing", () => {
      expect(where(docs, { pages: { in: [] } }).text).toBe("FALSE");
    });

    // `{}` matches every row, so an `or` holding it does too: no condition at all.
    it("drops an or with a branch that matches every row", async () => {
      expect(where(docs, { or: [{}, { pages: { eq: 1 } }] }).text).toBe('("docs"."pages" = $1)');
    });

    it("reserves `where` for filtering into a value", () => {
      // @ts-expect-error Testing nested `where` on a json column
      expect(() => where(docs, { settings: { where: { theme: { eq: "dark" } } } })).toThrow(
        'A nested `where` on the json column "settings" of "docs" is not supported yet.'
      );
    });
  });

  describe("value shorthands", () => {
    it("means eq where the runtime type takes one", () => {
      expect(where(docs, { title: "a" }).text).toBe('"docs"."title" = $1');
    });

    it("takes a plain-object value that names no operator, as an interval's Duration", () => {
      // @ts-expect-error Testing object as value on interval column
      const { text, params } = where(docs, { ttl: { days: 1 } });

      expect(text).toBe('"docs"."ttl" = $1');
      expect(params).toEqual(["1 day"]);
    });

    it.each([
      ["json", { settings: { theme: "dark" } }, "settings"],
      ["json", { settings: "dark" }, "settings"],
      ["bytes", { body: new Uint8Array([1]) }, "body"],
    ])("is refused on a %s column", (runtimeType, filter, field) => {
      // @ts-expect-error Testing bare value on a json/bytes column
      expect(() => where(docs, filter)).toThrow(
        `Filter the ${runtimeType} column "${field}" of "docs" with one of its operators ` +
          "(exists), not a bare value."
      );
    });

    it.each([
      ["array", { tags: ["a"] }, "tags", "eq, neq, contains, exists"],
      ["object", { limits: { cpu: 1 } }, "limits", "eq, neq, contains, exists, hasKey, where"],
    ])("is refused on an %s column", (runtimeType, filter, field, operators) => {
      // @ts-expect-error Testing bare value on an array/object column
      expect(() => where(docs, filter)).toThrow(
        `Filter the ${runtimeType} column "${field}" of "docs" with one of its operators ` +
          `(${operators}), not a bare value.`
      );
    });
  });

  describe("computed columns", () => {
    it("unwraps bare values for computed inputs", () => {
      const id = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const guid = encodeGlobalId("docs", { id });
      const userGuid = encodeGlobalId("users", { id: userId });

      const { text, params } = where(docs, {
        id: { eq: guid, neq: id },
        userId: { in: [userGuid], neq: userId },
        or: [{ id: guid }, { userId: userGuid }],
      });

      expect(text).toBe(
        '"docs"."id" = $1 AND "docs"."id" <> $2 AND "docs"."userId" IN ($3) AND "docs"."userId" <> $4 AND ("docs"."id" = $5 OR "docs"."userId" = $6)'
      );
      expect(params).toEqual([id, id, userId, userId, id, userId]);
    });
  });
});
