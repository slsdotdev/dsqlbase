import { describe, expect, it } from "vitest";
import { AnyTableDefinition } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";
import { diffTable } from "./table.js";

type Table = SerializedObject<AnyTableDefinition>;

const table = (constraints: Table["constraints"]): Table =>
  ({
    kind: "TABLE",
    name: "widgets",
    namespace: "public",
    columns: [],
    indexes: [],
    constraints,
  }) as Table;

describe("diffTable", () => {
  it("removes and adds a constraint whose kind changed under the same name", () => {
    const local = table([
      { kind: "CHECK_CONSTRAINT", name: "widgets_slug", expression: "slug <> ''" },
    ]);
    const remote = table([
      {
        kind: "UNIQUE_CONSTRAINT",
        name: "widgets_slug",
        columns: ["slug"],
        include: null,
        distinctNulls: true,
      },
    ]);

    expect(diffTable(local, remote).map((d) => [d.type, d.kind, d.name])).toEqual([
      ["add", "CHECK_CONSTRAINT", "widgets_slug"],
      ["remove", "UNIQUE_CONSTRAINT", "widgets_slug"],
    ]);
  });

  describe("CHECKs", () => {
    const check = (name: string, validated = true) =>
      ({ kind: "CHECK_CONSTRAINT", name, expression: "qty > 0", validated }) as const;
    const qty = (columnCheck: ReturnType<typeof check> | null = null) => ({
      kind: "COLUMN",
      name: "qty",
      dataType: "int",
      notNull: false,
      primaryKey: false,
      unique: false,
      defaultValue: null,
      check: columnCheck,
      domain: null,
      generated: null,
      identity: null,
    });
    const withChecks = (
      tableChecks: ReturnType<typeof check>[],
      columnCheck: ReturnType<typeof check> | null = null
    ) => ({ ...table(tableChecks), columns: [qty(columnCheck)] }) as unknown as Table;

    it("matches a table-level CHECK with a column's of the same name", () => {
      expect(
        diffTable(withChecks([check("qty_positive")]), withChecks([], check("qty_positive")))
      ).toEqual([]);
    });

    it("adds and removes CHECKs by name; expressions under one name aren't compared", () => {
      const diffs = diffTable(
        withChecks([check("qty_positive")]),
        withChecks([check("qty_nonzero")])
      );

      expect(diffs.map((d) => [d.type, d.name])).toEqual([
        ["add", "qty_positive"],
        ["remove", "qty_nonzero"],
      ]);
    });

    it("reports a CHECK left NOT VALID", () => {
      const diffs = diffTable(
        withChecks([check("qty_positive")]),
        withChecks([], check("qty_positive", false))
      );

      expect(diffs).toEqual([
        expect.objectContaining({
          type: "modify",
          key: "validated",
          value: true,
          prevValue: false,
        }),
      ]);
    });
  });
});
