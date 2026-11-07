import { describe, expectTypeOf, it } from "vitest";
import type { AnyColumn, PolicyConfig } from "@dsqlbase/core";
import { sql } from "@dsqlbase/core";
import { settings } from "./settings.js";
import { table } from "./table.js";
import { int } from "./columns/int.js";
import { text } from "./columns/text.js";
import { uuid } from "./columns/uuid.js";

const params = settings({ userId: uuid("identity.user_id") });

describe("table().policy()", () => {
  it("hands the callback the table's runtime columns", () => {
    table("docs", { id: uuid("id").primaryKey(), ownerId: uuid("owner_id") }).policy("own", (t) => {
      expectTypeOf(t.ownerId).toExtend<AnyColumn>();
      expectTypeOf(t.ownerId.name).toEqualTypeOf<"owner_id">();
      // @ts-expect-error no such column
      void t.missing;

      return { using: sql`${t.ownerId} = ${params.settings.userId}` };
    });
  });

  it("takes the RLS fields, and returns the table for chaining", () => {
    const docs = table("docs", { id: uuid("id").primaryKey(), title: text("title") })
      .policy("a", () => ({ as: "restrictive", for: ["update", "delete"], using: sql`true` }))
      .policy("b", () => ({ for: "insert", check: sql`true` }));

    expectTypeOf(docs.columns).toHaveProperty("title");
    expectTypeOf<{ as: "sometimes" }>().not.toExtend<PolicyConfig>();
  });
});

describe("$onCreate returning a setting", () => {
  it("accepts a setting of the column's type, and refuses another", () => {
    uuid("owner_id").$onCreate(() => params.settings.userId);

    const level = settings({ level: int("identity.level") });
    // @ts-expect-error an int setting cannot fill a uuid column
    uuid("owner_id").$onCreate(() => level.settings.level);
  });
});
