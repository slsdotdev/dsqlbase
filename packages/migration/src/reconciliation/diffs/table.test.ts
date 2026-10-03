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
});
