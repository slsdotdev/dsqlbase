import { describe, expect, it } from "vitest";
import { text, TextColumn } from "./TextColumn.js";
import { Table } from "../definition/table.js";

const table = new Table(undefined, "users");

describe("TextColumn", () => {
  it("should create a TextColumnBuilder with the correct name and type", () => {
    const column = text("username").build(table);

    expect(column).toBeInstanceOf(TextColumn);
    expect(column.name).toBe("username");
  });
});
