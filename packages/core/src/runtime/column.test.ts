import { describe, expect, it } from "vitest";
import {
  ColumnDefinition,
  DomainDefinition,
  TableDefinition,
  TenantScopeDefinition,
} from "../definition/index.js";
import { sql, SQLNode, SQLParam } from "../sql/index.js";
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

describe("Column / tenantKey", () => {
  const ws = new TenantScopeDefinition({
    workspaceId: new ColumnDefinition("workspace_id").notNull(),
  });

  const table = new Table(
    ws.table("invoices", {
      id: new ColumnDefinition("id", { primaryKey: true }),
      number: new ColumnDefinition("number").notNull(),
    })
  );

  it("carries the scope's marker onto the runtime column", () => {
    expect(table.columns.workspaceId.tenantKey).toBe(true);
    // A claim column is system-managed by construction; the scope sets both flags.
    expect(table.columns.workspaceId.readOnly).toBe(true);
  });

  it("defaults to false for every other column", () => {
    expect(table.columns.number.tenantKey).toBe(false);
    expect(table.columns.id.tenantKey).toBe(false);
  });
});

describe("Column.runtimeType", () => {
  const document = new DomainDefinition("document", { dataType: "jsonb", runtimeType: "json" });
  const table = new Table(
    new TableDefinition("files", {
      columns: {
        id: new ColumnDefinition("id", { primaryKey: true, runtimeType: "uuid" }),
        name: new ColumnDefinition("name"),
        meta: document.column("meta"),
      },
    })
  );

  it("carries the definition's runtime type", () => {
    expect(table.columns.id.runtimeType).toBe("uuid");
  });

  it("defaults to string, as the data type defaults to text", () => {
    expect(table.columns.name.runtimeType).toBe("string");
  });

  it("is inherited by a column made from a domain", () => {
    expect(table.columns.meta.runtimeType).toBe("json");
  });
});

describe("Column.validator", () => {
  const seen: string[] = [];

  // The codec marks what it touched; the validator trims writes, upper-cases reads, and
  // refuses "bad" — so each step's order and presence is observable.
  const label = () =>
    new ColumnDefinition("label", {
      dataType: "text",
      codec: {
        encode: (value: string) => `enc(${value})`,
        decode: (value: string) => `dec(${value})`,
      },
      validator: {
        write: (input: string) => {
          seen.push(`write ${input}`);
          if (input === "bad") throw new Error("refused");
          return input.trim();
        },
        read: (value: string) => {
          seen.push(`read ${value}`);
          if (value === "dec(bad)") throw new Error("refused");
          return value.toUpperCase();
        },
      },
    });

  const table = new Table(
    new TableDefinition("labels", {
      columns: { id: new ColumnDefinition("id", { primaryKey: true }), label: label() },
    })
  );
  const column = table.columns.label;

  const sent = (node: SQLNode) => sql`${node}`.toQuery().params;

  it("validates a write, then encodes the validated value", () => {
    seen.length = 0;

    expect(sent(column.getInsertValue(" a "))).toEqual(["enc(a)"]);
    expect(sent(column.getUpdateValue(" b "))).toEqual(["enc(b)"]);
    expect(sent(column.getInsertValue(new SQLParam(" c ")))).toEqual(["enc(c)"]);
    expect(seen).toEqual(["write  a ", "write  b ", "write  c "]);
  });

  it("refuses a write the validator refuses", () => {
    expect(() => sent(column.getInsertValue("bad"))).toThrow("refused");
    expect(() => sent(column.getUpdateValue("bad"))).toThrow("refused");
  });

  it("validates and encodes an $onUpdate value like any other write", () => {
    const hooked = new Table(
      new TableDefinition("hooked", {
        columns: {
          id: new ColumnDefinition("id", { primaryKey: true }),
          label: label().$onUpdate(() => " h "),
        },
      })
    ).columns.label;

    seen.length = 0;

    expect(sent(hooked.getUpdateValue(undefined))).toEqual(["enc(h)"]);
    expect(seen).toEqual(["write  h "]);
  });

  it("writes null without validating it", () => {
    seen.length = 0;

    expect(sent(column.getUpdateValue(null))).toEqual([null]);
    expect(seen).toEqual([]);
  });

  it("decodes a read, then validates the decoded value", () => {
    expect(column.resolve("x")).toBe("DEC(X)");
    expect(() => column.resolve("bad")).toThrow("refused");
    expect(column.resolve(null)).toBeNull();
  });

  it("validates a value read through a row decoder", () => {
    const decoded = Object.assign(Object.create(Object.getPrototypeOf(column) as object), column, {
      rowDecoder: { dependsOn: [], decode: (raw: unknown) => `row(${String(raw)})` },
    }) as typeof column;

    expect(decoded.resolveRow({ label: "x" })).toBe("ROW(X)");
  });

  // A filter value is compared with stored values, not stored: a fragment of a valid value, or
  // a value the validator would refuse, must still reach the database as given.
  it("does not validate a filter parameter", () => {
    seen.length = 0;

    expect(sent(column.param("bad"))).toEqual(["enc(bad)"]);
    expect(seen).toEqual([]);
  });

  it("validates a declared default", () => {
    const defaulted = label().default(" d ");

    expect(defaulted.toJSON().defaultValue).toBe("'enc(d)'");
    expect(() => label().default("bad").toJSON()).toThrow("refused");
  });
});
