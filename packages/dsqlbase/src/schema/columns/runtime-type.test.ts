import { describe, expect, it } from "vitest";
import type { AnyColumnDefinition } from "@dsqlbase/core";
import {
  $enum,
  array,
  bigint,
  boolean,
  bytea,
  char,
  date,
  domain,
  double,
  guid,
  identity,
  int,
  interval,
  json,
  numeric,
  real,
  smallint,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "../index.js";

const runtimeTypeOf = (column: AnyColumnDefinition) => column["_runtimeType"];

// The kind of value each builder holds, for querying — not its JavaScript form.
describe("column runtime types", () => {
  it.each([
    ["text", text("c"), "string"],
    ["varchar", varchar("c", 10), "string"],
    ["char", char("c", 1), "string"],
    ["uuid", uuid("c"), "uuid"],
    ["guid", guid("c"), "uuid"],
    ["int", int("c"), "number"],
    ["smallint", smallint("c"), "number"],
    ["real", real("c"), "number"],
    ["double", double("c"), "number"],
    ["numeric", numeric("c"), "number"],
    ["identity", identity("c"), "number"],
    ["bigint", bigint("c"), "bigint"],
    ["boolean", boolean("c"), "boolean"],
    ["date", date("c"), "date"],
    ["date read as a string", date("c", { mode: "string" }), "date"],
    ["time", time("c"), "date"],
    ["timestamp", timestamp("c"), "date"],
    ["interval", interval("c"), "interval"],
    ["bytea", bytea("c"), "bytes"],
    ["json", json("c"), "json"],
    ["array", array("c"), "array"],
  ] as [string, AnyColumnDefinition, string][])("%s is %s", (_, column, expected) => {
    expect(runtimeTypeOf(column)).toBe(expected);
  });

  it("is string for a domain and an enum, both text", () => {
    expect(runtimeTypeOf(domain("email").column("c"))).toBe("string");
    expect(runtimeTypeOf($enum("status", ["a", "b"]).column("c"))).toBe("string");
  });
});
