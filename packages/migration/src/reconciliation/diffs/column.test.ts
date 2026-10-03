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

  it("emits no diff for a default the database spells differently", () => {
    const local: Column = { ...baseColumn, defaultValue: "current_timestamp" };
    const remote: Column = { ...baseColumn, defaultValue: "CURRENT_TIMESTAMP" };

    expect(diffColumn(local, remote)).toEqual([]);
  });

  it("compares a domain column by its domain, not by how each side spells the type", () => {
    const local: Column = { ...baseColumn, domain: "app.status", dataType: `"app"."status"` };
    const remote: Column = { ...baseColumn, domain: "app.status", dataType: "app.status" };

    expect(diffColumn(local, remote)).toEqual([]);
    expect(diffColumn(local, { ...remote, domain: "app.state" })).toMatchObject([
      { key: "domain", value: "app.status", prevValue: "app.state" },
    ]);
  });

  it("emits a modify for a default that changed", () => {
    const local: Column = { ...baseColumn, defaultValue: "'1'" };
    const remote: Column = { ...baseColumn, defaultValue: "0" };

    expect(diffColumn(local, remote)).toEqual([
      expect.objectContaining({ type: "modify", key: "defaultValue" }),
    ]);
  });

  it.each([
    ["dataType", { dataType: "bigint" }],
    ["notNull", { notNull: true }],
    ["defaultValue", { defaultValue: "0" }],
    ["domain", { domain: "money" }],
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

    // What introspection reads back for an identity created from a definition that left the
    // sequence name and bounds to the database.
    const introspected = (local: Column["identity"]) =>
      ({
        type: local?.type ?? "ALWAYS",
        sequenceName: "qty_seq",
        options: {
          dataType: "bigint",
          cache: 1,
          cycle: false,
          increment: 1,
          minValue: 1,
          maxValue: Number("9223372036854775807"),
          startValue: 1,
          ownedBy: undefined,
        },
      }) as NonNullable<Column["identity"]>;

    it("emits no diff for a sequence name or options the definition leaves to the database", () => {
      const local: Column = {
        ...baseColumn,
        identity: {
          type: "ALWAYS",
          sequenceName: undefined,
          options: { dataType: "bigint", cache: 1, minValue: undefined, maxValue: undefined },
        },
      } as Column;
      const remote: Column = { ...baseColumn, identity: introspected(local.identity) };

      expect(diffColumn(local, remote)).toEqual([]);
    });

    it("emits a modify when a sequence name the definition sets differs", () => {
      const local: Column = {
        ...baseColumn,
        identity: { type: "ALWAYS", sequenceName: "qty_counter", options: { cache: 1 } },
      } as Column;
      const remote: Column = { ...baseColumn, identity: introspected(local.identity) };

      expect(diffColumn(local, remote)).toEqual([
        expect.objectContaining({ type: "modify", key: "identity" }),
      ]);
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

  it("leaves CHECKs to diffTable, which compares them by name wherever they are declared", () => {
    const local: Column = { ...baseColumn, check: checkA };
    expect(diffColumn(local, { ...baseColumn, check: checkB })).toEqual([]);
    expect(diffColumn(local, baseColumn)).toEqual([]);
  });
});
