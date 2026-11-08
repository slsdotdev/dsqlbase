import { describe, expect, it } from "vitest";
import { sql } from "./tag.js";
import { SQLClaim } from "./nodes.js";

describe("SQL nodes", () => {
  describe("SQLClaim", () => {
    const userId = new SQLClaim<string>("userId", (value) => `u:${value}`);

    it("binds the value the context carries, encoded", () => {
      const query = sql`SELECT ${userId}`.toQuery({ claims: { userId: "1" } });

      expect(query).toEqual({ text: "SELECT $1", params: ["u:1"] });
    });

    it("renders NULL when the context carries no settings, or not this one", () => {
      // `current_setting(key, true)` returns NULL for a missing key; a comparison with it is never
      // true, so a policy over an unset setting denies by itself.
      expect(sql`SELECT ${userId}`.toQuery().params).toEqual([null]);
      expect(sql`SELECT ${userId}`.toQuery({ claims: { other: "x" } }).params).toEqual([null]);
      expect(sql`SELECT ${userId}`.toQuery({ claims: { userId: null } }).params).toEqual([null]);
    });

    it("numbers its parameter with the rest of the statement", () => {
      const query = sql`${sql.param(1)} = ${userId}`.toQuery({ claims: { userId: "1" } });

      expect(query.text).toBe("$1 = $2");
    });

    it("keeps the settings inside a nested scope", () => {
      const query = sql`(${sql.wrap(sql`${userId}`)})`.toQuery({ claims: { userId: "1" } });

      expect(query.params).toEqual(["u:1"]);
    });
  });
});
