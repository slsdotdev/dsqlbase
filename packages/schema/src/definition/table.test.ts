import { describe, expect, it } from "vitest";
import { table } from "./table.js";
import { date } from "./columns/date.js";
import { uuid } from "./columns/uuid.js";
import { text } from "./columns/text.js";

describe("TableDefinition", () => {
  it("should create a table definition with the correct name and columns", () => {
    const usersTable = table("users", {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      email: text("email").notNull().unique(),
    });

    expect(usersTable.name).toBe("users");
  });

  it("should allow adding indexes to the table definition", () => {
    const usersTable = table("users", {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      email: text("email").notNull().unique(),
      createdAt: date("created_at").notNull(),
    });

    usersTable.index("email_idx", { unique: true });

    expect(usersTable.toJSON().indexes[0]).toMatchObject({
      kind: "INDEX",
      name: "email_idx",
      unique: true,
    });
  });

  it("should serialize to JSON correctly", () => {
    const usersTable = table("users", {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
      email: text("email").notNull().unique(),
    });

    const json = usersTable.toJSON();

    expect(json).toMatchObject({
      kind: "TABLE",
      name: "users",
      columns: expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          dataType: "UUID",
          primaryKey: true,
          notNull: true,
          unique: false,
        }),
        expect.objectContaining({
          name: "name",
          dataType: "text",
          primaryKey: false,
          notNull: true,
          unique: false,
        }),
        expect.objectContaining({
          name: "email",
          dataType: "text",
          primaryKey: false,
          notNull: true,
          unique: true,
        }),
      ]),
      indexes: [],
    });
  });
});
