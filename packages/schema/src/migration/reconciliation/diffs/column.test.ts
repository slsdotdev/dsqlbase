import { describe, expect, it } from "vitest";
import { diffColumn } from "./column.js";

type Column = Parameters<typeof diffColumn>[0];

const baseColumn: Column = {
  kind: "COLUMN",
  name: "qty",
  dataType: "int",
  notNull: false,
  primaryKey: false,
  unique: false,
  defaultValue: null,
  check: null,
  domain: null,
  generated: null,
  identity: null,
};

const checkA = { kind: "CHECK_CONSTRAINT", name: "qty_positive", expression: "qty > 0" } as const;
const checkB = { kind: "CHECK_CONSTRAINT", name: "qty_nonzero", expression: "qty <> 0" } as const;

describe("diffColumn", () => {
  it("emits a single add when no remote exists", () => {
    const diffs = diffColumn(baseColumn);
    expect(diffs).toEqual([{ type: "add", kind: "COLUMN", name: "qty", object: baseColumn }]);
  });

  it("emits no diffs when local and remote are identical", () => {
    expect(diffColumn(baseColumn, baseColumn)).toEqual([]);
  });

  it.each([
    ["dataType", { dataType: "bigint" }],
    ["notNull", { notNull: true }],
    ["defaultValue", { defaultValue: "0" }],
    ["domain", { domain: "money" }],
    ["primaryKey", { primaryKey: true }],
    ["unique", { unique: true }],
  ])("emits one diff entry for %s", (key, override) => {
    const local: Column = { ...baseColumn, ...(override as Partial<Column>) };
    const diffs = diffColumn(local, baseColumn);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ key });
  });

  describe("generated / identity (whole-config diff)", () => {
    const generated = { type: "ALWAYS", expression: "qty * 2", mode: "STORED" } as const;
    const identity = {
      type: "ALWAYS",
      sequenceName: "qty_seq",
      options: {
        dataType: "bigint",
        cache: 1,
        cycle: false,
        increment: 1,
        minValue: 1,
        maxValue: 1_000_000,
        startValue: 1,
        ownedBy: undefined,
      },
    } as const;

    it("emits an add when local introduces a generated config", () => {
      const local: Column = { ...baseColumn, generated };
      const diffs = diffColumn(local, baseColumn);
      expect(diffs).toEqual([
        expect.objectContaining({
          type: "add",
          key: "generated",
          value: generated,
          prevValue: null,
        }),
      ]);
    });

    it("emits a remove when remote had a generated config", () => {
      const remote: Column = { ...baseColumn, generated };
      const diffs = diffColumn(baseColumn, remote);
      expect(diffs).toEqual([
        expect.objectContaining({
          type: "remove",
          key: "generated",
          prevValue: generated,
        }),
      ]);
    });

    it("emits no diff when generated configs are deeply equal", () => {
      const local: Column = { ...baseColumn, generated };
      const remote: Column = { ...baseColumn, generated: { ...generated } };
      expect(diffColumn(local, remote)).toEqual([]);
    });

    it("emits a modify when nested identity options differ", () => {
      const local: Column = { ...baseColumn, identity };
      const remote: Column = {
        ...baseColumn,
        identity: { ...identity, options: { ...identity.options, cache: 65536 } },
      };
      const diffs = diffColumn(local, remote);
      expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "identity" })]);
    });

    it("emits no diff when identity is deeply equal", () => {
      const local: Column = { ...baseColumn, identity };
      const remote: Column = {
        ...baseColumn,
        identity: { ...identity, options: { ...identity.options } },
      };
      expect(diffColumn(local, remote)).toEqual([]);
    });
  });

  describe("CHECK constraint (name-only equality)", () => {
    it("emits no diff when names match but expressions differ", () => {
      const local: Column = {
        ...baseColumn,
        check: { ...checkA, expression: "qty > 0" },
      };
      const remote: Column = {
        ...baseColumn,
        check: { ...checkA, expression: "(qty > (0)::integer)" },
      };
      expect(diffColumn(local, remote)).toEqual([]);
    });

    it("emits no diff when both name and expression are identical", () => {
      const local: Column = { ...baseColumn, check: checkA };
      const remote: Column = { ...baseColumn, check: checkA };
      expect(diffColumn(local, remote)).toEqual([]);
    });

    it("emits an add and a remove (no modify) when names differ", () => {
      const local: Column = { ...baseColumn, check: checkA };
      const remote: Column = { ...baseColumn, check: checkB };
      const diffs = diffColumn(local, remote);

      expect(diffs).toEqual([
        {
          type: "modify",
          kind: local.kind,
          name: local.name,
          object: local,
          key: "check",
          value: checkA,
          prevValue: checkB,
        },
      ]);
    });

    it("emits an add when only local has a check", () => {
      const local: Column = { ...baseColumn, check: checkA };
      const diffs = diffColumn(local, baseColumn);
      expect(diffs).toEqual([
        {
          type: "add",
          kind: local.kind,
          name: local.name,
          object: local,
          key: "check",
          value: checkA,
          prevValue: null,
        },
      ]);
    });

    it("emits a remove when only remote has a check", () => {
      const remote: Column = { ...baseColumn, check: checkA };
      const diffs = diffColumn(baseColumn, remote);
      expect(diffs).toEqual([
        {
          type: "remove",
          kind: baseColumn.kind,
          name: baseColumn.name,
          object: baseColumn,
          key: "check",
          value: null,
          prevValue: checkA,
        },
      ]);
    });
  });
});
