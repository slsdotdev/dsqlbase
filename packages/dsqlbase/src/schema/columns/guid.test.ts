import { describe, expect, it } from "vitest";
import { GuidColumnDefinition, guid } from "./guid.js";
import { uuid } from "./uuid.js";

describe("guid", () => {
  it("should serialize exactly as uuid", () => {
    // Migration-neutral by construction: the node key is a client-side rule, so switching an
    // existing column from uuid() to guid() has to produce no DDL at all.
    expect(guid("id").toJSON()).toEqual(uuid("id").toJSON());
    expect(guid("author_id", "authors").notNull().toJSON()).toEqual(
      uuid("author_id").notNull().toJSON()
    );
    expect(guid("id").primaryKey().defaultRandom().toJSON()).toEqual(
      uuid("id").primaryKey().defaultRandom().toJSON()
    );
  });

  it("should keep the node key out of the serialized form", () => {
    expect(guid("author_id", "authors").toJSON()).not.toHaveProperty("guid");
    expect(guid("author_id", "authors").toJSON()).not.toHaveProperty("key");
  });

  it("should carry the declared key, and nothing when none was given", () => {
    expect(guid("author_id", "authors")["_guidKey"]).toBe("authors");
    // Undefined means "this column's own table", which cannot be resolved until the client is
    // built — a column does not know the alias it is exported under.
    expect(guid("id")["_guidKey"]).toBeUndefined();
  });

  it("should inherit defaultRandom from the uuid column", () => {
    expect(guid("id").primaryKey().defaultRandom().toJSON().defaultValue).toBe("gen_random_uuid()");
  });

  it("should stay a GuidColumnDefinition through the builders and a clone", () => {
    const column = guid("author_id", "authors").notNull();

    expect(column).toBeInstanceOf(GuidColumnDefinition);
    // `clone()` rebuilds from the prototype, so the copy has to stay detectable as a guid
    // column — `tenantScope().columns()` is one caller, and the node pass reads the class.
    expect(column.clone()).toBeInstanceOf(GuidColumnDefinition);
    expect(column.clone()["_guidKey"]).toBe("authors");
  });
});
