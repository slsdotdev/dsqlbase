import { describe, expect, it } from "vitest";
import { sql } from "./tag.js";
import { SQLSetting } from "./nodes.js";

describe("SQLSetting", () => {
  const userId = new SQLSetting<string>("userId", "identity.user_id", (value) => `u:${value}`);

  it("binds the value the context carries, encoded", () => {
    const query = sql`SELECT ${userId}`.toQuery({ settings: { userId: "1" } });

    expect(query).toEqual({ text: "SELECT $1", params: ["u:1"] });
  });

  it("renders NULL when the context carries no settings, or not this one", () => {
    // `current_setting(key, true)` returns NULL for a missing key; a comparison with it is never
    // true, so a policy over an unset setting denies by itself.
    expect(sql`SELECT ${userId}`.toQuery().params).toEqual([null]);
    expect(sql`SELECT ${userId}`.toQuery({ settings: { other: "x" } }).params).toEqual([null]);
    expect(sql`SELECT ${userId}`.toQuery({ settings: { userId: null } }).params).toEqual([null]);
  });

  it("numbers its parameter with the rest of the statement", () => {
    const query = sql`${sql.param(1)} = ${userId}`.toQuery({ settings: { userId: "1" } });

    expect(query.text).toBe("$1 = $2");
  });

  it("keeps the settings inside a nested scope", () => {
    const query = sql`(${sql.wrap(sql`${userId}`)})`.toQuery({ settings: { userId: "1" } });

    expect(query.params).toEqual(["u:1"]);
  });
});
