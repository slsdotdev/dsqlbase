import { describe, expect, it } from "vitest";
import { sql } from "../sql/index.js";
import { groupPolicies, resolvePolicy } from "./policy.js";

const cond = sql`true`;
const other = sql`false`;

describe("resolvePolicy", () => {
  it("defaults to a permissive policy for every command, its check taken from using", () => {
    const policy = resolvePolicy("docs", "p", { using: cond });

    expect(policy.as).toBe("permissive");
    expect(policy.commands).toEqual(["select", "insert", "update", "delete"]);
    expect(policy.using).toBe(cond);
    expect(policy.check).toBe(cond);
  });

  it("expands a list of commands, keeping a declared check", () => {
    const policy = resolvePolicy("docs", "p", {
      as: "restrictive",
      for: ["delete", "update"],
      using: cond,
      check: other,
    });

    expect(policy.commands).toEqual(["update", "delete"]);
    expect(policy.check).toBe(other);
  });

  it("carries no check for a read-only policy", () => {
    expect(resolvePolicy("docs", "p", { for: "select", using: cond }).check).toBeUndefined();
  });

  it.each([
    [{ for: "insert", using: cond, check: cond }, /`using`, which an insert has no existing row/],
    [{ for: "select", using: cond, check: cond }, /`check`, which only an insert or update/],
    [{ for: ["select", "delete"], using: cond, check: cond }, /`check`, which only an insert/],
    [{ for: "delete" }, /needs `using`/],
    [{ for: "all", check: cond }, /needs `using`/],
    [{ for: "insert" }, /needs `check`/],
    [{ for: [] }, /applies to no command/],
  ] as const)("refuses what CREATE POLICY would, or what means nothing: %o", (config, error) => {
    expect(() => resolvePolicy("docs", "p", config)).toThrow(error);
  });

  it("accepts an insert policy with only a check", () => {
    expect(resolvePolicy("docs", "p", { for: "insert", check: cond }).check).toBe(cond);
  });
});

describe("groupPolicies", () => {
  it("splits each command's policies into permissive and restrictive, in order", () => {
    const a = resolvePolicy("docs", "a", { for: "select", using: cond });
    const b = resolvePolicy("docs", "b", { as: "restrictive", using: cond });
    const c = resolvePolicy("docs", "c", { for: ["select", "update"], using: cond });

    const byCommand = groupPolicies([a, b, c]);

    expect(byCommand.get("select")?.permissive).toEqual([a, c]);
    expect(byCommand.get("select")?.restrictive).toEqual([b]);
    expect(byCommand.get("insert")?.permissive).toEqual([]);
    expect(byCommand.get("delete")?.restrictive).toEqual([b]);
  });
});
