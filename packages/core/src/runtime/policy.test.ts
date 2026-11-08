import { describe, expect, it } from "vitest";
import { sql } from "../sql/index.js";
import { resolvePolicy } from "./policy.js";
import { TableDefinition } from "../definition/table.js";
import { ColumnDefinition } from "../definition/column.js";
import { Table } from "./table.js";
import { PolicyDefinition } from "../definition/policy.js";

const cond = sql`true`;
const other = sql`false`;

const tableDef = new TableDefinition("table", {
  columns: {
    id: new ColumnDefinition("id", { dataType: "text" }),
  },
});

const table = new Table(tableDef);

describe("Policy", () => {
  describe("resolvePolicy", () => {
    it("defaults to a permissive policy for every command, its check taken from using", () => {
      const policyDef = new PolicyDefinition("table_policy", {
        table: tableDef,
        using: cond,
      });

      const policy = resolvePolicy(table, policyDef);

      expect(policy.as).toBe("permissive");
      expect(policy.commands).toEqual(["select", "insert", "update", "delete"]);
      expect(policy.using).toBe(cond);
      expect(policy.check).toBe(cond);
    });

    it("expands a list of commands, keeping a declared check", () => {
      const policyDef = new PolicyDefinition("table_policy", {
        table: tableDef,
        as: "restrictive",
        for: ["delete", "update"],
        using: cond,
        check: other,
      });

      const policy = resolvePolicy(table, policyDef);

      expect(policy.commands).toEqual(["update", "delete"]);
      expect(policy.check).toBe(other);
    });

    it("carries no check for a read-only policy", () => {
      const policyDef = new PolicyDefinition("table_policy", {
        table: tableDef,
        for: "select",
        using: cond,
      });

      expect(resolvePolicy(table, policyDef).check).toBeUndefined();
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
      const table = new Table(tableDef);
      const policyDef = new PolicyDefinition("p", {
        table: tableDef,
        ...config,
      });

      expect(() => resolvePolicy(table, policyDef)).toThrow(error);
    });

    it("accepts an insert policy with only a check", () => {
      const table = new Table(tableDef);
      const policyDef = new PolicyDefinition("p", {
        table: tableDef,
        for: "insert",
        check: cond,
      });

      expect(resolvePolicy(table, policyDef).check).toBe(cond);
    });
  });
});
