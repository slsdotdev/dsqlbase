import { describe, expect, it } from "vitest";
import { diffIndex } from "./indexes.js";

type Index = Parameters<typeof diffIndex>[0];

const slugColumn = {
  kind: "INDEX_COLUMN",
  name: "widgets_slug_idx_column_slug",
  sortDirection: "ASC",
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

describe("diffIndex", () => {
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

  it("emits a modify on `columns` when sort direction changes", () => {
    const local: Index = {
      ...baseIndex,
      columns: [{ ...slugColumn, sortDirection: "DESC" }],
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
      columns: [{ ...slugColumn, sortDirection: "DESC" }],
      include: ["status"],
    };
    const diffs = diffIndex(local, baseIndex);
    expect(diffs.map((d) => d.key)).toEqual(["unique", "distinctNulls", "columns", "include"]);
  });
});
