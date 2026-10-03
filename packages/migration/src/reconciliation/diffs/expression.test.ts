import { describe, expect, it } from "vitest";
import { sameDefault } from "./expression.js";

// Pairs of (definition `toJSON`, what PostgreSQL prints back), collected from PGlite for every
// builder default; DSQL prints the same.
describe("sameDefault", () => {
  it.each([
    ["current_timestamp", "CURRENT_TIMESTAMP"],
    ["gen_random_uuid()", "gen_random_uuid()"],
    ["'x'", "'x'::text"],
    ["'it''s'", "'it''s'::text"],
    ["'v'", "'v'::character varying"],
    ["'abc'", "'abc'::bpchar"],
    ["'0'", "0"],
    ["'-5'", "'-5'::integer"],
    ["'3'", "'3'::smallint"],
    ["'10'", "'10'::bigint"],
    ["'1.5'", "1.5"],
    ["'0'", "'0'::numeric"],
    ["'1.25'", "'1.25'::real"],
    ["'2.5'", "'2.5'::double precision"],
    ["'2024-01-02'", "'2024-01-02'::date"],
    ["'10:11:12'", "'10:11:12'::time without time zone"],
    ["'1 day'", "'1 day'::interval"],
    ["'[1,2]'", "'[1,2]'::json"],
    [`'["x"]'`, `'["x"]'::jsonb`],
    [`'{"a":1}'`, `'{"a": 1}'::jsonb`],
    [`'{"k":"v","a":[1]}'`, `'{"a": [1], "k": "v"}'::jsonb`],
    ["true", "true"],
    ["false", "false"],
  ])("treats %s and %s as the same default", (local, remote) => {
    expect(sameDefault(local, remote)).toBe(true);
  });

  it.each([
    ["'EUR'", "'eur'::text"],
    ["'1'", "'2'::integer"],
    ["'x'", "'x '::text"],
    ["current_timestamp", "now()"],
    ["true", "false"],
    // Same JSON, but a text column: the text differs, so the default does.
    [`'{"a":1}'`, `'{"a": 1}'::text`],
    // A timestamp literal prints in the session's time zone: not normalized (deferred).
    ["'2024-01-02T03:04:05.000Z'", "'2024-01-02 05:04:05+02'::timestamp with time zone"],
  ])("treats %s and %s as different defaults", (local, remote) => {
    expect(sameDefault(local, remote)).toBe(false);
  });

  it("compares absence", () => {
    expect(sameDefault(null, null)).toBe(true);
    expect(sameDefault(undefined, null)).toBe(true);
    expect(sameDefault("'x'", null)).toBe(false);
    expect(sameDefault(null, "'x'::text")).toBe(false);
  });
});
