import { describe, expect, it } from "vitest";
import { ColumnDefinition, TableDefinition } from "../definition/index.js";
import { sql, SQLParam } from "../sql/index.js";
import { Table } from "./table.js";

describe("Column", () => {
  const table = new Table(
    new TableDefinition("events", {
      columns: {
        id: new ColumnDefinition("id", { primaryKey: true }),
        // A codec that rewrites the value, so encoding is observable.
        ref: new ColumnDefinition("ref", {
          dataType: "text",
          codec: {
            encode: (value: string) => value.replace(/^id_/, ""),
            decode: (value: string) => `id_${value}`,
          },
        }),
      },
    })
  );

  describe("param", () => {
    it("encodes a value with the column's codec", () => {
      const { text, params } = sql`${table.columns.ref.param("id_42")}`.toQuery();

      expect(text).toBe("$1");
      expect(params).toEqual(["42"]);
    });

    it("returns an SQLParam", () => {
      expect(table.columns.ref.param("id_42")).toBeInstanceOf(SQLParam);
    });

    // A column reference or sub-expression is SQL, not a value — encoding it would be
    // nonsense. This is what lets a filter compare two columns.
    it("passes an SQL node through untouched", () => {
      const node = table.columns.id;

      expect(table.columns.ref.param(node)).toBe(node);
      expect(sql`${table.columns.ref.param(node)}`.toQuery().text).toBe('"events"."id"');
    });

    it("passes a raw SQL fragment through untouched", () => {
      const raw = sql.raw("CURRENT_DATE");

      expect(table.columns.ref.param(raw)).toBe(raw);
      expect(sql`${table.columns.ref.param(raw)}`.toQuery()).toEqual({
        text: "CURRENT_DATE",
        params: [],
      });
    });

    it("uses the identity codec when the column declares none", () => {
      const { params } = sql`${table.columns.id.param("plain")}`.toQuery();

      expect(params).toEqual(["plain"]);
    });
  });
});

describe("Column / readOnly", () => {
  const table = new Table(
    new TableDefinition("invoices", {
      columns: {
        id: new ColumnDefinition("id", { primaryKey: true }),
        workspaceId: new ColumnDefinition("workspace_id").notNull().readOnly(),
        number: new ColumnDefinition("number").notNull(),
      },
    })
  );

  it("carries the definition's flag onto the runtime column", () => {
    expect(table.columns.workspaceId.readOnly).toBe(true);
  });

  it("defaults to false for every other column", () => {
    expect(table.columns.number.readOnly).toBe(false);
    expect(table.columns.id.readOnly).toBe(false);
  });
});
