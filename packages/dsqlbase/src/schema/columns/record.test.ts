import { describe, expect, it } from "vitest";
import { JsonColumnDefinition } from "./json.js";
import { record } from "./record.js";
import { ColumnValidationError } from "../utils/column-validation.js";

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
