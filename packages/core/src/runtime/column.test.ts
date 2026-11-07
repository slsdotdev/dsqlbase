import { describe, expect, it } from "vitest";
import { ColumnDefinition, DomainDefinition, TableDefinition } from "../definition/index.js";
import type { ColumnHookContext } from "../resolvers/index.js";
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

describe("Column.hooks", () => {
  const steps: string[] = [];
  const contexts: ColumnHookContext[] = [];

  // Every step records itself, so the order of codec, hooks and validator is observable.
  const label = () =>
    new ColumnDefinition("label", {
      dataType: "text",
      codec: {
        encode: (value: string) => (steps.push("encode"), `enc(${value})`),
        decode: (value: string) => (steps.push("decode"), `dec(${value})`),
      },
      validator: {
        write: (input: string) => (steps.push("validate write"), input),
        read: (value: string) => (steps.push("validate read"), value),
      },
      hooks: {
        write: (value: string, context: ColumnHookContext) => {
          steps.push("hook write");
          contexts.push(context);
          return `w(${value})`;
        },
        read: (value: string, context: ColumnHookContext) => {
          steps.push("hook read");
          contexts.push(context);
          return `r(${value})`;
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

  const reset = () => {
    steps.length = 0;
    contexts.length = 0;
  };

  it("runs a write through the validator, then the write hook, then the codec", () => {
    reset();

    expect(sent(column.getInsertValue("a"))).toEqual(["enc(w(a))"]);
    expect(sent(column.getUpdateValue("b"))).toEqual(["enc(w(b))"]);
    expect(steps).toEqual([
      "validate write",
      "hook write",
      "encode",
      "validate write",
      "hook write",
      "encode",
    ]);
    expect(contexts).toEqual([{ column }, { column }]);
  });

  it("runs a filter value through the write hook and the codec, never the validator", () => {
    reset();

    expect(sent(column.param("x"))).toEqual(["enc(w(x))"]);
    expect(steps).toEqual(["hook write", "encode"]);
  });

  it("runs a read through the codec, then the read hook with the row, then the validator", () => {
    reset();
    const row = { label: "x", other: 1 };

    expect(column.resolve("x", row)).toBe("r(dec(x))");
    expect(steps).toEqual(["decode", "hook read", "validate read"]);
    expect(contexts[0]?.column).toBe(column);
    expect(contexts[0]?.row).toBe(row);
  });

  it("does not run hooks for null", () => {
    reset();

    expect(column.resolve(null)).toBeNull();
    expect(sent(column.getUpdateValue(null))).toEqual([null]);
    expect(steps).toEqual([]);
  });

  // A default is DDL: a definition has no runtime column to hand a hook.
  it("does not run hooks for a declared default", () => {
    reset();

    expect(label().default("d").toJSON().defaultValue).toBe("'enc(d)'");
    expect(steps).toEqual(["validate write", "encode"]);
  });
});

// `row_to_json` emits bigint and numeric as JSON numbers, rounded before the codec sees them.
describe("Column.textInJson", () => {
  const table = new Table(
    new TableDefinition("amounts", {
      columns: {
        id: new ColumnDefinition("id", { dataType: "uuid", primaryKey: true }),
        big: new ColumnDefinition("big", { dataType: "bigint", runtimeType: "bigint" }),
        money: new ColumnDefinition("money", { dataType: "numeric(12,2)", runtimeType: "number" }),
        viaDomain: new ColumnDefinition("via_domain", { dataType: "ids", runtimeType: "bigint" }),
        count: new ColumnDefinition("count", { dataType: "int", runtimeType: "number" }),
      },
    })
  );

  it("is set for bigint and numeric, by type or runtime type, and nothing else", () => {
    const { id, big, money, viaDomain, count } = table.columns;

    expect([id, big, money, viaDomain, count].map((column) => column.textInJson)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});
