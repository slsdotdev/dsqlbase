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

describe("sql.keyset", () => {
  const a = sql.identifier("a");
  const b = sql.identifier("b");
  const id = sql.identifier("id");

  const render = (node: ReturnType<typeof sql.keyset>) => sql`${node}`.toQuery();

  it("reads past a single ascending key", () => {
    const query = render(sql.keyset([{ node: id, direction: "asc" }], ["7"], "after"));

    expect(query.text).toBe(`"id" > $1`);
    expect(query.params).toEqual(["7"]);
  });

  it("reads past a single descending key", () => {
    const query = render(sql.keyset([{ node: id, direction: "desc" }], ["7"], "after"));

    expect(query.text).toBe(`"id" < $1`);
  });

  it("flips every comparison for a page before the cursor", () => {
    const keys = [
      { node: a, direction: "desc" as const },
      { node: id, direction: "asc" as const },
    ];

    expect(render(sql.keyset(keys, ["x", "7"], "before")).text).toBe(
      `"a" > $1 OR ("a" = $2 AND "id" < $3)`
    );
  });

  it("breaks a tie on the next key", () => {
    const keys = [
      { node: a, direction: "desc" as const },
      { node: id, direction: "desc" as const },
    ];
    const query = render(sql.keyset(keys, ["x", "7"], "after"));

    expect(query.text).toBe(`"a" < $1 OR ("a" = $2 AND "id" < $3)`);
    expect(query.params).toEqual(["x", "x", "7"]);
  });

  it("nests every level above the last in parentheses, one direction per key", () => {
    const keys = [
      { node: a, direction: "asc" as const },
      { node: b, direction: "desc" as const },
      { node: id, direction: "asc" as const },
    ];

    expect(render(sql.keyset(keys, ["x", "y", "7"], "after")).text).toBe(
      `"a" > $1 OR ("a" = $2 AND ("b" < $3 OR ("b" = $4 AND "id" > $5)))`
    );
  });

  it("binds values as bare text parameters", () => {
    const keys = [{ node: a, direction: "asc" as const }];
    const query = render(sql.keyset(keys, ["2026-09-27 12:00:00.123456+00"], "after"));

    expect(query.params).toEqual(["2026-09-27 12:00:00.123456+00"]);
  });

  it("refuses an empty key list", () => {
    expect(() => sql.keyset([], [], "after")).toThrow(/at least one order key/);
  });

  it("refuses a value count that does not match the keys", () => {
    expect(() => sql.keyset([{ node: id, direction: "asc" }], [], "after")).toThrow(
      /pairs every key with one value/
    );
  });

  it("refuses a nullable key", () => {
    expect(() =>
      sql.keyset([{ node: id, direction: "asc", nullable: true }], ["7"], "after")
    ).toThrow(/nullable order keys are not supported/);
  });

  it("refuses a null value", () => {
    const values = [null] as unknown as string[];

    expect(() => sql.keyset([{ node: id, direction: "asc" }], values, "after")).toThrow(
      /nullable order keys are not supported/
    );
  });
});
