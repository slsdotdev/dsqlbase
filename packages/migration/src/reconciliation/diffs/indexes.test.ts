import { describe, expect, it } from "vitest";
import { diffIndex } from "./indexes.js";

type Index = Parameters<typeof diffIndex>[0];

const slugColumn = {
  kind: "INDEX_COLUMN",
  name: "widgets_slug_idx_column_slug",
  nulls: "LAST",
  column: "slug",
} as const;

const baseIndex: Index = {
  kind: "INDEX",
  name: "widgets_slug_idx",
  unique: false,
  distinctNulls: true,
  columns: [slugColumn],
  include: null,
};

const nameColumn = {
  kind: "INDEX_COLUMN",
  name: "widgets_slug_idx_column_name",
  nulls: "LAST",
  column: "name",
} as const;

describe("diffIndex", () => {
  it("emits a modify on `columns` when the key order changes", () => {
    const local: Index = { ...baseIndex, columns: [slugColumn, nameColumn] };
    const remote: Index = { ...baseIndex, columns: [nameColumn, slugColumn] };

    expect(diffIndex(local, remote)).toEqual([
      expect.objectContaining({ type: "modify", key: "columns" }),
    ]);
  });

  it("does not reorder the arrays it compares", () => {
    const local: Index = { ...baseIndex, columns: [slugColumn, nameColumn] };
    const remote: Index = { ...baseIndex, columns: [nameColumn, slugColumn] };

    diffIndex(local, remote);

    expect(local.columns.map((c) => c.column)).toEqual(["slug", "name"]);
    expect(remote.columns.map((c) => c.column)).toEqual(["name", "slug"]);
  });

  it("ignores the order of `include` columns, which carries no meaning", () => {
    const local: Index = { ...baseIndex, include: ["a", "b"] };
    const remote: Index = { ...baseIndex, include: ["b", "a"] };

    expect(diffIndex(local, remote)).toEqual([]);
  });

  it("emits no diffs when local and remote are identical", () => {
    expect(diffIndex(baseIndex, baseIndex)).toEqual([]);
  });

  it("emits a modify on `unique` when toggled", () => {
    const diffs = diffIndex({ ...baseIndex, unique: true }, baseIndex);
    expect(diffs).toEqual([
      expect.objectContaining({ type: "modify", key: "unique", value: true, prevValue: false }),
    ]);
  });

  it("emits a modify on `distinctNulls` when toggled", () => {
    const diffs = diffIndex({ ...baseIndex, distinctNulls: false }, baseIndex);
    expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "distinctNulls" })]);
  });

  it("emits a modify on `columns` when a key's NULLS order changes", () => {
    const local: Index = {
      ...baseIndex,
      columns: [{ ...slugColumn, nulls: "FIRST" }],
    };
    const diffs = diffIndex(local, baseIndex);
    expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "columns" })]);
  });

  it("emits a modify on `columns` when a column is appended", () => {
    const second = { ...slugColumn, name: "widgets_slug_idx_column_qty" as const, column: "qty" };
    const local: Index = { ...baseIndex, columns: [slugColumn, second] };
    const diffs = diffIndex(local, baseIndex);
    expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "columns" })]);
  });

  it("emits a modify on `include` when include list changes", () => {
    const diffs = diffIndex({ ...baseIndex, include: ["status"] }, baseIndex);
    expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "include" })]);
  });

  it("emits one diff per attribute when several change at once", () => {
    const local: Index = {
      ...baseIndex,
      unique: true,
      distinctNulls: false,
      columns: [{ ...slugColumn, nulls: "FIRST" }],
      include: ["status"],
    };
    const diffs = diffIndex(local, baseIndex);
    expect(diffs.map((d) => d.key)).toEqual(["unique", "distinctNulls", "columns", "include"]);
  });
});
