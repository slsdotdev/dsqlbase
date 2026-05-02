import { describe, expect, it } from "vitest";
import { diffConstraint } from "./constraint.js";
import { SerializedObject } from "../../base.js";
import { AnyConstraintDefinition } from "@dsqlbase/core/definition";

const pk: SerializedObject<AnyConstraintDefinition> = {
  kind: "PRIMARY_KEY_CONSTRAINT",
  name: "widgets_pkey",
  columns: ["id"],
  include: null,
};

const unique: SerializedObject<AnyConstraintDefinition> = {
  kind: "UNIQUE_CONSTRAINT",
  name: "widgets_slug_unique",
  columns: ["slug"],
  include: null,
  distinctNulls: true,
};

const check: SerializedObject<AnyConstraintDefinition> = {
  kind: "CHECK_CONSTRAINT",
  name: "qty_positive",
  expression: "qty > 0",
};

describe("diffConstraint", () => {
  it("emits no diff when both sides are identical", () => {
    expect(diffConstraint(pk, pk)).toEqual([]);
    expect(diffConstraint(unique, unique)).toEqual([]);
    expect(diffConstraint(check, check)).toEqual([]);
  });

  describe("PRIMARY_KEY_CONSTRAINT", () => {
    it("emits a modify on `columns` when the column list changes", () => {
      const local: SerializedObject<AnyConstraintDefinition> = {
        ...pk,
        columns: ["id", "tenant_id"],
      };
      const diffs = diffConstraint(local, pk);
      expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "columns" })]);
    });

    it("emits a modify on `include` when include list changes", () => {
      const local: SerializedObject<AnyConstraintDefinition> = { ...pk, include: ["status"] };
      const diffs = diffConstraint(local, pk);
      expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "include" })]);
    });
  });

  describe("UNIQUE_CONSTRAINT", () => {
    it("emits a modify on `columns` when the column list changes", () => {
      const local: SerializedObject<AnyConstraintDefinition> = {
        ...unique,
        columns: ["slug", "tenant_id"],
      };
      const diffs = diffConstraint(local, unique);
      expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "columns" })]);
    });

    it("emits a modify on `distinctNulls` when toggled", () => {
      const local: SerializedObject<AnyConstraintDefinition> = { ...unique, distinctNulls: false };
      const diffs = diffConstraint(local, unique);
      expect(diffs).toEqual([expect.objectContaining({ type: "modify", key: "distinctNulls" })]);
    });

    it("emits one diff per attribute when several change at once", () => {
      const local: SerializedObject<AnyConstraintDefinition> = {
        ...unique,
        columns: ["slug", "tenant_id"],
        include: ["status"],
        distinctNulls: false,
      };
      const diffs = diffConstraint(local, unique);
      expect(diffs.map((d) => d.key)).toEqual(["columns", "include", "distinctNulls"]);
    });
  });

  describe("CHECK_CONSTRAINT (name-only equality)", () => {
    it("emits no diff when names match but expressions differ", () => {
      const remote: SerializedObject<AnyConstraintDefinition> = {
        ...check,
        expression: "(qty > (0)::integer)",
      };
      expect(diffConstraint(check, remote)).toEqual([]);
    });
  });
});
