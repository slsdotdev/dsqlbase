import { describe, expect, expectTypeOf, it } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { table, text, uuid } from "../../schema/index.js";

// A deprecated column stays in the database until a later release drops it, but the client
// doesn't see it: not in results, filters, ordering or inputs.
const people = table("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nickname: text("nickname").notNull().deprecated(),
});

const session: Session = { execute: async () => [] };
const dsql = createClient({ schema: { people }, session });

describe("deprecated columns", () => {
  it("are gone from results", () => {
    // Built, never awaited: only its row type is read.
    const query = dsql.people.findMany({});
    expect(query).toBeDefined();

    expectTypeOf<(typeof query.$typeOf)[number]>().not.toHaveProperty("nickname");
    expectTypeOf<(typeof query.$typeOf)[number]>().toHaveProperty("name");
  });

  // Type-only: never called, since the runtime refuses the deprecated field as well.
  it("aren't required on create, and are gone from filters, selection and ordering", () => {
    const typeOnly = () => {
      void dsql.people.create({ data: { name: "a" } });
      // @ts-expect-error -- deprecated: not filterable
      void dsql.people.findMany({ where: { nickname: "b" } });
      // @ts-expect-error -- deprecated: not selectable
      void dsql.people.findMany({ select: { nickname: true } });
      // @ts-expect-error -- deprecated: not orderable
      void dsql.people.findMany({ orderBy: { nickname: "asc" } });
    };

    expect(typeOnly).toBeTypeOf("function");
  });

  it("are refused at runtime too", () => {
    expect(() => dsql.people.create({ data: { name: "a", nickname: "b" } as never })).toThrow(
      /nickname/
    );
    expect(() => dsql.people.findMany({ where: { nickname: "b" } as never })).toThrow(/nickname/);
  });
});
