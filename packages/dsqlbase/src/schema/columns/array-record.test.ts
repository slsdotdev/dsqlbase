import { describe, expect, it } from "vitest";
import { ColumnValidationError } from "../utils/column-validation.js";
import type { StandardSchemaV1 } from "../utils/standard-schema.js";
import { array } from "./array.js";
import { JsonColumnDefinition } from "./json.js";
import { record } from "./record.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJsonColumn = JsonColumnDefinition<string, any>;

/** A write as the built column runs it: validated, then encoded. */
function write(column: AnyJsonColumn, input: unknown): unknown {
  const validator = column["_validator"];
  return column["_codec"].encode(validator ? validator.write(input) : input);
}

/** A read as the built column runs it: decoded, then validated. */
function read(column: AnyJsonColumn, stored: unknown): unknown {
  const validator = column["_validator"];
  const value = column["_codec"].decode(stored);
  return validator ? validator.read(value) : value;
}

/** Upper-cases every item, and refuses a non-string one. */
const upperItems: StandardSchemaV1<string[]> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      Array.isArray(value) && value.every((item) => typeof item === "string")
        ? { value: value.map((item: string) => item.toUpperCase()) }
        : { issues: [{ message: "Expected strings", path: [0] }] },
  },
};

describe("array()", () => {
  it("is a jsonb column of runtime type array", () => {
    expect(array("tags").toJSON().dataType).toBe("jsonb");
    expect(array("tags")["_runtimeType"]).toBe("array");
  });

  // The text-backed array() it replaces lost both.
  it("stores items as given, commas and emptiness included", () => {
    expect(write(array("tags"), ["a,b", "c"])).toBe('["a,b","c"]');
    expect(write(array("tags"), [])).toBe("[]");
    expect(read(array("tags"), ["a,b"])).toEqual(["a,b"]);
    expect(read(array("tags"), [])).toEqual([]);
  });

  it.each([
    ["an object", { a: 1 }],
    ["a string", "a,b"],
    ["a number", 1],
  ])("refuses %s, on write and on read", (_, value) => {
    const error = (phase: string) =>
      new ColumnValidationError("invalid", "tags", phase as "write", [
        { message: "Expected an array" },
      ]);

    expect(() => write(array("tags"), value)).toThrow(error("write"));
    expect(() => read(array("tags"), value)).toThrow(error("read"));
  });

  it("checks the shape with a schema too: before it on read, after it on write", () => {
    const tags = array("tags").schema(upperItems);

    expect(write(tags, ["a"])).toBe('["A"]');
    expect(read(tags, ["b"])).toEqual(["B"]);
    expect(() => read(tags, "a")).toThrow(
      'Invalid value for column "tags" on read: Expected an array'
    );

    // A schema whose output is not an array is refused by the types; the runtime still holds.
    const loose: StandardSchemaV1 = {
      "~standard": { version: 1, vendor: "test", validate: () => ({ value: "x" }) },
    };
    expect(() =>
      write(array("tags").schema(loose as StandardSchemaV1<unknown, unknown[]>), ["a"])
    ).toThrow("Expected an array");
  });

  it("validates a default", () => {
    expect(array("tags").default([]).toJSON().defaultValue).toBe("'[]'");
    expect(() => array("tags").default("x" as unknown as unknown[])).toThrow(ColumnValidationError);
  });
});

describe("record()", () => {
  it("is a jsonb column of runtime type object", () => {
    expect(record("limits").toJSON().dataType).toBe("jsonb");
    expect(record("limits")["_runtimeType"]).toBe("object");
  });

  it("stores and reads a plain object", () => {
    expect(write(record("limits"), { cpu: 2, tags: ["a"] })).toBe('{"cpu":2,"tags":["a"]}');
    expect(write(record("limits"), Object.create(null) as object)).toBe("{}");
    expect(read(record("limits"), { cpu: 2 })).toEqual({ cpu: 2 });
  });

  // A Date or a Map is an object, but not one JSON keeps as an object.
  it.each([
    ["an array", [1]],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["a string", "x"],
  ])("refuses %s on write", (_, value) => {
    expect(() => write(record("limits"), value)).toThrow(
      'Invalid value for column "limits" on write: Expected an object'
    );
  });

  it("refuses a stored value that is not an object", () => {
    expect(() => read(record("limits"), [1])).toThrow(
      'Invalid value for column "limits" on read: Expected an object'
    );
  });

  it("validates a default", () => {
    expect(record("limits").default({}).toJSON().defaultValue).toBe("'{}'");
    expect(() => record("limits").default([] as unknown as Record<string, unknown>)).toThrow(
      ColumnValidationError
    );
  });
});
