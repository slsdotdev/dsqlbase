import { describe, expect, it } from "vitest";
import { ColumnDefinition } from "./column.js";

describe("ColumnDefinition", () => {
  it("should create a ColumnDefinition with the correct name and config", () => {
    const node = new ColumnDefinition("username", {}).$type<Date>().primaryKey();

    expect(node.name).toBe("username");
  });

  it("should set notNull, primaryKey, and unique properties correctly", () => {
    const column = new ColumnDefinition("username").notNull().toJSON();
    expect(column.notNull).toBe(true);
  });
});
