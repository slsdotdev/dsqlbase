import { describe, expectTypeOf, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import type { StandardSchemaV1 } from "../../schema/utils/standard-schema.js";
import { json, jsonb, table, uuid } from "../../schema/index.js";

type SettingsIn = { theme?: "light" | "dark"; since: string | Date };
type SettingsOut = { theme: "light" | "dark"; since: Date };

// Typed only: these tests never validate a value.
const settings = {} as StandardSchemaV1<SettingsIn, SettingsOut>;

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  settings: jsonb("settings").schema(settings).notNull(),
  profile: jsonb("profile").schema(settings),
  tags: jsonb("tags").$type<string[]>(),
  legacy: json("legacy"),
});

const session = { execute: vi.fn(async () => []) } as unknown as Session;
const dsql = createClient({ schema: { users }, session });

describe("a JSON column's types", () => {
  it("reads the schema's output", async () => {
    const user = await dsql.users.findOne({ where: { id: "u1" } });

    expectTypeOf(user?.settings).toEqualTypeOf<SettingsOut | undefined>();
    expectTypeOf(user?.profile).toEqualTypeOf<SettingsOut | null | undefined>();
  });

  it("writes the schema's input", () => {
    const check = () => {
      dsql.users.create({ data: { settings: { since: "2026-10-01" } } });
      dsql.users.update({ where: { id: "u1" }, set: { profile: null } });

      // @ts-expect-error `since` is required by the schema's input
      dsql.users.create({ data: { settings: {} } });

      // @ts-expect-error the column is not null
      dsql.users.update({ where: { id: "u1" }, set: { settings: null } });
    };

    expectTypeOf(check).toBeFunction();
  });

  it("reads and writes one type with $type, and unknown with neither", async () => {
    const user = await dsql.users.findOne({ where: { id: "u1" } });

    expectTypeOf(user?.tags).toEqualTypeOf<string[] | null | undefined>();
    expectTypeOf(user?.legacy).toEqualTypeOf<unknown>();
  });

  it("takes the schema's input as a default", () => {
    expectTypeOf(jsonb("s").schema(settings).default).parameter(0).toEqualTypeOf<SettingsIn>();
  });
});
