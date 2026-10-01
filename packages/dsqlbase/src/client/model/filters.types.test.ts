import { describe, expectTypeOf, it, vi } from "vitest";
import type { Schema, Session } from "@dsqlbase/core";
import type { TableByAlias } from "@dsqlbase/core/runtime";
import { createClient } from "../create.js";
import type { OrderByExpressionOf, WhereExpressionOf } from "./base.js";
import {
  $enum,
  array,
  boolean,
  bytea,
  int,
  json,
  table,
  text,
  union,
  uuid,
} from "../../schema/index.js";

const status = $enum("status", ["draft", "live"]);

const docs = table("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  status: status.column("status"),
  pages: int("pages"),
  draft: boolean("draft"),
  body: bytea("body"),
  settings: json("settings").$type<{ theme: string }>(),
  tags: array("tags"),
});

const notes = table("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  settings: json("settings").$type<{ theme: string }>(),
});

const items = union({ docs, notes });
const schema = { docs, notes, items };

const session = { execute: vi.fn(async () => []) } as unknown as Session;
const dsql = createClient({ schema, session });

type Docs = TableByAlias<Schema<typeof schema>, "docs">;
type Where = WhereExpressionOf<Docs>;
type OrderBy = OrderByExpressionOf<Docs>;

describe("filters follow the runtime type", () => {
  it("offers each column its operators", () => {
    expectTypeOf<keyof Exclude<Where["title"], string | null | undefined>>().toEqualTypeOf<
      | "eq"
      | "neq"
      | "in"
      | "gt"
      | "gte"
      | "lt"
      | "lte"
      | "between"
      | "exists"
      | "beginsWith"
      | "endsWith"
      | "contains"
    >();
    expectTypeOf<keyof Exclude<Where["draft"], boolean | null | undefined>>().toEqualTypeOf<
      "eq" | "neq" | "exists"
    >();
    expectTypeOf<Where["settings"]>().toEqualTypeOf<{ exists?: boolean } | undefined>();
    expectTypeOf<Where["body"]>().toEqualTypeOf<{ exists?: boolean } | undefined>();
  });

  it("keeps an enum's values and the shorthand on comparable columns", () => {
    expectTypeOf<{ status: "live" }>().toMatchTypeOf<Where>();
    expectTypeOf<{ pages: { gte: 1; lte: 5 } }>().toMatchTypeOf<Where>();
  });

  it("orders by every column but documents, arrays and binary", () => {
    expectTypeOf<keyof OrderBy>().toEqualTypeOf<"id" | "title" | "status" | "pages" | "draft">();
  });

  // Type-checked only: each call also throws at runtime.
  it("refuses what the runtime refuses", () => {
    const check = () => {
      dsql.docs.findMany({
        // @ts-expect-error a json column has no value shorthand
        where: { settings: { theme: "dark" } },
      });

      dsql.docs.findMany({
        // @ts-expect-error a json column filters by exists only
        where: { settings: { eq: { theme: "dark" } } },
      });

      dsql.docs.findMany({
        // @ts-expect-error contains is a string operator
        where: { id: { contains: "x" } },
      });

      dsql.docs.findMany({
        // @ts-expect-error a boolean is not ordered by gt
        where: { draft: { gt: true } },
      });

      dsql.docs.findMany({
        // @ts-expect-error an array() column has no value shorthand
        where: { tags: ["a"] },
      });

      dsql.docs.findMany({
        // @ts-expect-error a json column cannot be ordered by
        orderBy: { settings: "asc" },
      });

      dsql.items.findMany({
        // @ts-expect-error nor a json field shared across a union
        orderBy: { settings: "asc" },
      });

      dsql.items.findMany({
        // @ts-expect-error a shared json field filters by exists only, as in every member
        where: { settings: { eq: "x" } },
      });

      dsql.docs.findMany({ where: { settings: { exists: true } } });
      dsql.items.findMany({ where: { settings: { exists: false } }, orderBy: { title: "asc" } });
    };

    expectTypeOf(check).toBeFunction();
  });
});
