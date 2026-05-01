import { describe, expect, it } from "vitest";
import { normalizeObject } from "./normalizer.js";

const baseColumn = {
  kind: "COLUMN" as const,
  notNull: false,
  defaultValue: null,
  domain: null,
  generated: null,
  identity: null,
};

describe("normalizeObject", () => {
  describe("dataType aliasing", () => {
    it("rewrites format_type long-form to schema short-form on DOMAIN.dataType", () => {
      const result = normalizeObject({
        kind: "DOMAIN",
        name: "email",
        namespace: "public",
        dataType: "character varying(255)",
        notNull: false,
        defaultValue: null,
        check: null,
      }) as { dataType: string };

      expect(result.dataType).toBe("varchar(255)");
    });

    it("rewrites integer → int and character → char on TABLE columns", () => {
      const result = normalizeObject({
        kind: "TABLE",
        name: "t",
        namespace: "public",
        columns: [
          { ...baseColumn, name: "a", dataType: "integer" },
          { ...baseColumn, name: "b", dataType: "character(8)" },
        ],
        indexes: [],
        constraints: [],
      }) as { columns: { name: string; dataType: string }[] };

      expect(result.columns.map((c) => c.dataType)).toEqual(["int", "char(8)"]);
    });

    it("leaves already-canonical types untouched", () => {
      const result = normalizeObject({
        kind: "DOMAIN",
        name: "d",
        namespace: "public",
        dataType: "uuid",
        notNull: false,
        defaultValue: null,
        check: null,
      }) as { dataType: string };

      expect(result.dataType).toBe("uuid");
    });

    it.each([
      ["timestamp without time zone", "timestamp"],
      ["timestamp without time zone(6)", "timestamp(6)"],
      ["timestamp with time zone", "timestamp with time zone"],
      ["time without time zone", "time"],
      ["time with time zone", "time with time zone"],
      ["bigint", "bigint"],
      ["numeric(10,2)", "numeric(10,2)"],
    ])("rewrites %s → %s", (input, expected) => {
      const result = normalizeObject({
        kind: "DOMAIN",
        name: "d",
        namespace: "public",
        dataType: input,
        notNull: false,
        defaultValue: null,
        check: null,
      }) as { dataType: string };

      expect(result.dataType).toBe(expected);
    });
  });

  describe("sequence options coercion", () => {
    it("converts ::text numerics to numbers and null → undefined", () => {
      const result = normalizeObject({
        kind: "SEQUENCE",
        name: "ticket_seq",
        namespace: "public",
        options: {
          dataType: "bigint",
          cache: "1",
          cycle: false,
          increment: "2",
          minValue: "1",
          maxValue: "1000000",
          startValue: "1",
          ownedBy: null,
        },
      }) as { options: Record<string, unknown> };

      expect(result.options).toEqual({
        dataType: "bigint",
        cache: 1,
        cycle: false,
        increment: 2,
        minValue: 1,
        maxValue: 1_000_000,
        startValue: 1,
        ownedBy: undefined,
      });
    });

    it("applies the same coercion to identity.options", () => {
      const result = normalizeObject({
        kind: "TABLE",
        name: "widgets",
        namespace: "public",
        columns: [
          {
            ...baseColumn,
            name: "id",
            dataType: "bigint",
            notNull: true,
            identity: {
              type: "ALWAYS",
              sequenceName: "widgets_id_seq",
              options: {
                dataType: "bigint",
                cache: "1",
                cycle: false,
                increment: "1",
                minValue: "1",
                maxValue: "1000000",
                startValue: "1",
                ownedBy: null,
              },
            },
          },
        ],
        indexes: [],
        constraints: [],
      }) as { columns: { identity: { options: Record<string, unknown> } | null }[] };

      expect(result.columns[0].identity?.options).toEqual({
        dataType: "bigint",
        cache: 1,
        cycle: false,
        increment: 1,
        minValue: 1,
        maxValue: 1_000_000,
        startValue: 1,
        ownedBy: undefined,
      });
    });
  });

  describe("constraint splitting", () => {
    function table(constraints: unknown[]) {
      return normalizeObject({
        kind: "TABLE",
        name: "widgets",
        namespace: "public",
        columns: [
          { ...baseColumn, name: "id", dataType: "uuid", notNull: true },
          { ...baseColumn, name: "slug", dataType: "text", notNull: true },
          { ...baseColumn, name: "qty", dataType: "int", notNull: true },
        ],
        indexes: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constraints: constraints as any,
      }) as {
        columns: {
          name: string;
          primaryKey: boolean;
          unique: boolean;
          check: { name: string; expression: string } | null;
        }[];
        constraints: unknown[];
      };
    }

    it("collapses single-column PK onto column.primaryKey, drops it from constraints[]", () => {
      const result = table([
        {
          kind: "PRIMARY_KEY_CONSTRAINT",
          name: "widgets_pkey",
          columns: ["id"],
          expression: null,
          distinctNulls: null,
          include: null,
        },
      ]);

      expect(result.columns.find((c) => c.name === "id")?.primaryKey).toBe(true);
      expect(result.constraints).toEqual([]);
    });

    it("collapses single-column UNIQUE onto column.unique", () => {
      const result = table([
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "widgets_slug_key",
          columns: ["slug"],
          expression: null,
          distinctNulls: true,
          include: null,
        },
      ]);

      expect(result.columns.find((c) => c.name === "slug")?.unique).toBe(true);
      expect(result.constraints).toEqual([]);
    });

    it("collapses single-column CHECK onto column.check", () => {
      const result = table([
        {
          kind: "CHECK_CONSTRAINT",
          name: "qty_positive",
          columns: ["qty"],
          expression: "CHECK (qty > 0)",
          distinctNulls: null,
          include: null,
        },
      ]);

      expect(result.columns.find((c) => c.name === "qty")?.check).toEqual({
        kind: "CHECK_CONSTRAINT",
        name: "qty_positive",
        expression: "CHECK (qty > 0)",
      });
      expect(result.constraints).toEqual([]);
    });

    it("keeps multi-column constraints at the table level with ColumnJSON-as-string columns", () => {
      const result = table([
        {
          kind: "PRIMARY_KEY_CONSTRAINT",
          name: "widgets_pkey",
          columns: ["id", "slug"],
          expression: null,
          distinctNulls: null,
          include: null,
        },
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "widgets_compound_key",
          columns: ["slug", "qty"],
          expression: null,
          distinctNulls: false,
          include: null,
        },
      ]);

      expect(result.columns.every((c) => c.primaryKey === false)).toBe(true);
      expect(result.constraints).toEqual([
        {
          kind: "PRIMARY_KEY_CONSTRAINT",
          name: "widgets_pkey",
          columns: ["id", "slug"],
          include: null,
        },
        {
          kind: "UNIQUE_CONSTRAINT",
          name: "widgets_compound_key",
          columns: ["slug", "qty"],
          include: null,
          distinctNulls: false,
        },
      ]);
    });
  });

  describe("index column synthesis", () => {
    it("adds the synthetic IndexColumnDefinition.name", () => {
      const result = normalizeObject({
        kind: "TABLE",
        name: "widgets",
        namespace: "public",
        columns: [{ ...baseColumn, name: "slug", dataType: "text", notNull: true }],
        indexes: [
          {
            kind: "INDEX",
            name: "widgets_slug_idx",
            unique: false,
            distinctNulls: true,
            columns: [
              { kind: "INDEX_COLUMN", column: "slug", sortDirection: "ASC", nulls: "LAST" },
            ],
            include: null,
          },
        ],
        constraints: [],
      }) as { indexes: { columns: Record<string, unknown>[] }[] };

      expect(result.indexes[0].columns[0]).toEqual({
        kind: "INDEX_COLUMN",
        name: "widgets_slug_idx_column_slug",
        sortDirection: "ASC",
        nulls: "LAST",
        column: "slug",
      });
    });
  });

  describe("VIEW / FUNCTION filter", () => {
    it("returns null for VIEW and FUNCTION rows so introspect() drops them", () => {
      expect(normalizeObject({ kind: "VIEW", name: "v", namespace: "public" })).toBeNull();
      expect(normalizeObject({ kind: "FUNCTION", name: "f", namespace: "public" })).toBeNull();
    });
  });
});
