import { describe, expect, it } from "vitest";
import { NamespaceDefinition } from "./namespace.js";
import { ColumnDefinition } from "./column.js";

describe("NamespaceDefinition", () => {
  it("should create a NamespaceDefinition with the correct name", () => {
    const namespace = new NamespaceDefinition("test_namespace");

    expect(namespace.name).toBe("test_namespace");
  });

  it("should create a table within the namespace", () => {
    const namespace = new NamespaceDefinition("test_namespace");

    const table = namespace.table("users", {
      id: new ColumnDefinition("id").primaryKey(),
      name: new ColumnDefinition("name").notNull(),
    });

    expect(table.name).toBe("users");
    expect(table.columns).toHaveProperty("id");
    expect(table.columns.id).toBeInstanceOf(ColumnDefinition);
    expect(table.columns).toHaveProperty("name");
    expect(table.columns.name).toBeInstanceOf(ColumnDefinition);
  });

  it("should create a domain within the namespace", () => {
    const namespace = new NamespaceDefinition("test_namespace");

    const domain = namespace.domain("positive_int").notNull();
    const json = domain.toJSON();

    expect(json.name).toBe("positive_int");
    expect(json.namespace).toBe("test_namespace");
    expect(json.dataType).toBe("text");
    expect(json.notNull).toBe(true);
  });

  it("should create a sequence within the namespace", () => {
    const namespace = new NamespaceDefinition("test_namespace");

    const sequence = namespace.sequence("user_id_seq");
    const json = sequence.toJSON();

    expect(json.name).toBe("user_id_seq");
    expect(json.namespace).toBe("test_namespace");
  });
});
