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
  it("should keep incremental parameter indices correct in nested queries", () => {
    const subQuery1 = sql`select id from orders where user_id = ${1}`;
    const subQuery2 = sql`select id from payments where user_id = ${2}`;
    const query = sql`select name from users where id IN (${subQuery1}) OR id IN (${subQuery2}) and status <> ${sql.param("inactive")}`;
    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      "select name from users where id IN (select id from orders where user_id = $1) OR id IN (select id from payments where user_id = $2) and status <> $3"
    );
    expect(builtQuery.params).toEqual([1, 2, "inactive"]);
  });
  it("should keep params in cirrent order, with more than 10 params", () => {
    const params = Array.from({ length: 12 }, (_, i) => i + 1);

    const query = sql`select * from users where ${sql.join(
      params.map((param, index) => sql`${sql.raw(`col${index}`)} = ${param}`),
      " AND "
    )}`;

    const builtQuery = query.toQuery();

    expect(builtQuery.text).toBe(
      "select * from users where col0 = $1 AND col1 = $2 AND col2 = $3 AND col3 = $4 AND col4 = $5 AND col5 = $6 AND col6 = $7 AND col7 = $8 AND col8 = $9 AND col9 = $10 AND col10 = $11 AND col11 = $12"
    );
    expect(builtQuery.params).toEqual(params);
  });
});
