import { describe, expect, it } from "vitest";
import { ColumnValidationError } from "../utils/column-validation.js";
import type { StandardSchemaV1 } from "../utils/standard-schema.js";
import { json, jsonb } from "./json.js";

// `pg` and PGlite parse `json` / `jsonb` into JS values before a row reaches the codec, and a
// joined row arrives inside parsed JSON. What the codec decodes is a value, never JSON text.
describe("json decode", () => {
  const { decode } = json("c")["_codec"];

  it("returns a JSON string as the string it is", () => {
    expect(decode("123")).toBe("123");
    expect(decode("true")).toBe("true");
    expect(decode('{"a":1}')).toBe('{"a":1}');
  });

  it("returns objects, arrays and other primitives untouched", () => {
    const document = { a: [1, "b"] };

    expect(decode(document)).toBe(document);
    expect(decode(1)).toBe(1);
    expect(decode(false)).toBe(false);
  });
});

/**
 * A Standard Schema written by hand, standing in for zod & co.: `parse` returns the output, or
 * `undefined` with an issue. Typed `In` → `Out` the way a library declares it.
 */
function schemaOf<In, Out>(
  parse: (value: unknown) => { value: Out } | { issue: string },
  vendor = "test"
): StandardSchemaV1<In, Out> {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate: (value) => {
        const result = parse(value);
        return "issue" in result
          ? { issues: [{ message: result.issue, path: ["theme"] }] }
          : { value: result.value };
      },
    },
  };
}

type Settings = { theme: "light" | "dark"; since: string };

// Fills `theme`, and coerces `since` (a date string or Date) to its ISO form.
const settings = schemaOf<{ theme?: "light" | "dark"; since: string | Date }, Settings>((value) => {
  const input = value as { theme?: unknown; since?: unknown };
  const theme = input.theme ?? "light";

  if (theme !== "light" && theme !== "dark") {
    return { issue: "expected light or dark" };
  }

  const since = new Date(input.since as string).toISOString();
  return { value: { theme, since } };
});

describe("json .schema()", () => {
  const codec = () => jsonb("settings").schema(settings)["_codec"];

  it("stores the validated output, defaults filled, in its JSON form", () => {
    expect(codec().encode({ since: "2026-10-01" })).toBe(
      '{"theme":"light","since":"2026-10-01T00:00:00.000Z"}'
    );
  });

  it("validates a read and returns the output", () => {
    expect(codec().decode({ theme: "dark", since: "2026-10-01" })).toEqual({
      theme: "dark",
      since: "2026-10-01T00:00:00.000Z",
    });
  });

  it("refuses a value the schema refuses, on write and on read", () => {
    // @ts-expect-error not a theme: the runtime refuses it as the types do
    expect(() => codec().encode({ theme: "blue", since: "2026-10-01" })).toThrow(
      new ColumnValidationError("invalid", "settings", "write", [
        { message: "expected light or dark", path: ["theme"] },
      ])
    );
    expect(() => codec().decode({ theme: "blue" })).toThrow(
      'Invalid value for column "settings" on read: theme: expected light or dark'
    );
  });

  it("refuses a schema that transforms, on the first write that reaches it", () => {
    const split = schemaOf<string, string[]>((value) =>
      typeof value === "string" ? { value: value.split(",") } : { issue: "expected a string" }
    );
    const exclaim = schemaOf<string, string>((value) => ({ value: `${value as string}!` }));

    expect(() => json("tags").schema(split)["_codec"].encode("a,b")).toThrow(
      'Invalid value for column "tags" on write'
    );
    expect(() => json("note").schema(exclaim)["_codec"].encode("x")).toThrow(
      expect.objectContaining({ code: "unstable", column: "note" })
    );
  });

  it("refuses an output with no JSON form", () => {
    const big = schemaOf<number, bigint>((value) => ({ value: BigInt(value as number) }));

    expect(() => json("n").schema(big)["_codec"].encode(1)).toThrow(
      expect.objectContaining({ code: "not_json" })
    );
  });

  it("refuses a schema that validates asynchronously", () => {
    const pending: StandardSchemaV1<string> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (value) => ({ value: value as string }),
      },
    };

    expect(() => json("c").schema(pending)["_codec"].encode("x")).toThrow(
      expect.objectContaining({ code: "async", phase: "write" })
    );
  });

  it("validates a default when declared, before or after the schema", () => {
    const after = jsonb("settings").default({ since: "2026-01-01" }).schema(settings);
    const before = jsonb("settings").schema(settings).default({ since: "2026-01-01" });

    expect(after.toJSON().defaultValue).toBe(
      `'{"theme":"light","since":"2026-01-01T00:00:00.000Z"}'`
    );
    expect(before.toJSON().defaultValue).toBe(after.toJSON().defaultValue);
    expect(() => jsonb("settings").default({ theme: "blue" }).schema(settings)).toThrow(
      ColumnValidationError
    );
  });

  it("leaves a column without a schema unvalidated", () => {
    expect(jsonb("c")["_codec"].encode({ any: ["thing"] })).toBe('{"any":["thing"]}');
  });
});

describe("jsonb", () => {
  it("is a json runtime type over the jsonb data type", () => {
    const column = jsonb("c");

    expect(column.toJSON().dataType).toBe("jsonb");
    expect(column["_runtimeType"]).toBe("json");
  });
});
