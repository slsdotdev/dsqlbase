import { describe, it, expect } from "vitest";
import { sql } from "./tag.js";

describe("sql tag", () => {
  it("should create a SQLQuery from a template literal", () => {
    const query = sql`select * from users where id = ${1}`;
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe("select * from users where id = $1");
    expect(builtQuery.params).toEqual([1]);
  });

  it("should handle multiple parameters", () => {
    const query = sql`select * from users where id = ${1} and name = ${"Alice"}`;
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe("select * from users where id = $1 and name = $2");
    expect(builtQuery.params).toEqual([1, "Alice"]);
  });

  it("should handle raw SQL segments", () => {
    const query = sql`select ${sql.raw("*")} from users`;
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe("select * from users");
    expect(builtQuery.params).toEqual([]);
  });

  it("should handle inline parameters", () => {
    const query = sql`select * from users where id = ${1}`;
    const builtQuery = query.toQuery({ inlineParams: true });

    expect(builtQuery.text).toBe("select * from users where id = 1");
    expect(builtQuery.params).toEqual([]);
  });

  it("should handle null parameters", () => {
    const query = sql`select * from users where name = ${null}`;
    const builtQuery = query.toQuery({ inlineParams: true });

    expect(builtQuery.text).toBe("select * from users where name = null");
    expect(builtQuery.params).toEqual([]);
  });

  it("should throw an error for unsupported parameter types when inlining", () => {
    const query = sql`select * from users where data = ${Symbol("test")}`;

    expect(() => query.toQuery({ inlineParams: true })).toThrow(
      "Unsupported parameter type: symbol"
    );
  });

  it("should allow using SQLNode parameters directly", () => {
    const query = sql`select ${sql.identifier("name")} from users`;
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe('select "name" from users');
    expect(builtQuery.params).toEqual([]);
  });

  it("should allow joining nodes with a separator", () => {
    const query = sql.join([sql`a`, sql`b`, sql`c`], ", ");
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe("a, b, c");
    expect(builtQuery.params).toEqual([]);
  });

  it("should handle complex nested queries", () => {
    const subQuery = sql`select id from orders where user_id = ${1}`;
    const query = sql`select name from users where id IN (${subQuery})`;
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      "select name from users where id IN (select id from orders where user_id = $1)"
    );
    expect(builtQuery.params).toEqual([1]);
  });
});
