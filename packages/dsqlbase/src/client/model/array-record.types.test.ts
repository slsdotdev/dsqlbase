import { describe, expectTypeOf, it, vi } from "vitest";
import type { Schema, Session } from "@dsqlbase/core";
import type { TableByAlias } from "@dsqlbase/core/runtime";
import { createClient } from "../create.js";
import type { WhereExpressionOf } from "./filters.js";
import type { StandardSchemaV1 } from "../../schema/utils/standard-schema.js";
import { array, record, table, uuid } from "../../schema/index.js";

type Panel = { id: number; open: boolean };
type Limits = { cpu: number; memory?: number };

// Typed only: these tests never validate a value.
const labels = {} as StandardSchemaV1<string[], string[]>;
const quotas = {} as StandardSchemaV1<Record<string, number>>;
const text = {} as StandardSchemaV1<string>;

const boards = table("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tags: array("tags").$type<string>().notNull(),
  aliases: array("aliases").$type<string[]>(),
  grid: array("grid").$type<number[][]>(),
  panels: array("panels").$type<Panel>(),
  labels: array("labels").schema(labels),
  anything: array("anything"),
  limits: record("limits").$type<Limits>(),
  quotas: record("quotas").schema(quotas),
  meta: record("meta"),
});

const schema = { boards };
const session = { execute: vi.fn(async () => []) } as unknown as Session;
const dsql = createClient({ schema, session });

type Where = WhereExpressionOf<TableByAlias<Schema<typeof schema>, "boards">>;
type Filter<K extends keyof Where> = Exclude<Where[K], undefined>;

describe("array() and record() types", () => {
  it("reads $type as the item type or the array type, and an untyped array as unknown[]", async () => {
    const board = await dsql.boards.findOne({ where: { id: "b1" } });

    expectTypeOf(board?.tags).toEqualTypeOf<string[] | undefined>();
    expectTypeOf(board?.aliases).toEqualTypeOf<string[] | null | undefined>();
    expectTypeOf(board?.grid).toEqualTypeOf<number[][] | null | undefined>();
    expectTypeOf(board?.panels).toEqualTypeOf<Panel[] | null | undefined>();
    expectTypeOf(board?.labels).toEqualTypeOf<string[] | null | undefined>();
    expectTypeOf(board?.anything).toEqualTypeOf<unknown[] | null | undefined>();
  });

  it("reads a record's $type exactly as given, and an untyped record as Record<string, unknown>", async () => {
    const board = await dsql.boards.findOne({ where: { id: "b1" } });

    expectTypeOf(board?.limits).toEqualTypeOf<Limits | null | undefined>();
    expectTypeOf(board?.quotas).toEqualTypeOf<Record<string, number> | null | undefined>();
    expectTypeOf(board?.meta).toEqualTypeOf<Record<string, unknown> | null | undefined>();
  });

  it("takes only a schema of the column's shape", () => {
    const check = () => {
      // @ts-expect-error an array column takes a schema whose output is an array
      array("a").schema(text);

      // @ts-expect-error a record column takes a schema whose output is an object
      record("r").schema(text);

      array("a").schema(labels);
      record("r").schema(quotas);
    };

    expectTypeOf(check).toBeFunction();
  });

  it("filters an array by item fragments, a record by fragment and key", () => {
    expectTypeOf<keyof Filter<"panels">>().toEqualTypeOf<"eq" | "neq" | "contains" | "exists">();
    expectTypeOf<Filter<"panels">["contains"]>().toEqualTypeOf<
      { id?: number; open?: boolean }[] | undefined
    >();
    expectTypeOf<Filter<"anything">["contains"]>().toEqualTypeOf<unknown[] | undefined>();

    expectTypeOf<keyof Filter<"limits">>().toEqualTypeOf<
      "eq" | "neq" | "contains" | "hasKey" | "exists"
    >();
    expectTypeOf<Filter<"limits">["contains"]>().toEqualTypeOf<
      { cpu?: number; memory?: number } | undefined
    >();
    expectTypeOf<Filter<"limits">["hasKey"]>().toEqualTypeOf<string | undefined>();
  });

  // Type-checked only.
  it("refuses what the runtime refuses", () => {
    const check = () => {
      dsql.boards.findMany({
        // @ts-expect-error contains on an array takes an array of items
        where: { tags: { contains: "a" } },
      });

      dsql.boards.findMany({
        // @ts-expect-error hasKey is a record operator
        where: { tags: { hasKey: "a" } },
      });

      dsql.boards.findMany({
        // @ts-expect-error an array column has no value shorthand
        where: { tags: ["a"] },
      });

      dsql.boards.findMany({
        // @ts-expect-error a record column cannot be ordered by
        orderBy: { limits: "asc" },
      });

      dsql.boards.findMany({ where: { panels: { contains: [{ id: 1 }] } } });
      dsql.boards.findMany({ where: { limits: { hasKey: "cpu", contains: { cpu: 2 } } } });
    };

    expectTypeOf(check).toBeFunction();
  });
});
