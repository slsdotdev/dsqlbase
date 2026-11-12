import { describe, expect, it } from "vitest";
import {
  CURSOR_PREFIX,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  keysetSignature,
} from "./cursor.js";

const keys = [
  { field: "createdAt", direction: "desc" as const },
  { field: "id", direction: "desc" as const },
];

const signature = keysetSignature("tasks", keys);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof InvalidCursorError ? error.code : error;
  }
};

describe("keysetSignature", () => {
  it("is 8 hex characters", () => {
    expect(signature).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is stable for the same table and order", () => {
    expect(keysetSignature("tasks", [...keys])).toBe(signature);
  });

  it.each([
    ["the table alias", keysetSignature("projects", keys)],
    ["a field", keysetSignature("tasks", [{ ...keys[0], field: "updatedAt" }, keys[1]])],
    ["a direction", keysetSignature("tasks", [{ ...keys[0], direction: "asc" }, keys[1]])],
    ["the key order", keysetSignature("tasks", [keys[1], keys[0]])],
  ])("changes with %s", (_, other) => {
    expect(other).not.toBe(signature);
  });
});

describe("encodeCursor / decodeCursor", () => {
  const values = ["2026-09-27 12:00:00.123456+00", "3f1c0e3e-0a3f-4a1e-9c2e-8b5f1d2a7c44"];

  it("round-trips the key values verbatim", () => {
    const cursor = encodeCursor(signature, values);

    expect(decodeCursor(cursor, signature, 2)).toEqual(values);
  });

  it("carries the format version as a prefix", () => {
    expect(encodeCursor(signature, values).startsWith(CURSOR_PREFIX)).toBe(true);
  });

  it("carries a null key, which the format has room for", () => {
    const cursor = encodeCursor(signature, [null, values[1]]);

    expect(decodeCursor(cursor, signature, 2)).toEqual([null, values[1]]);
  });

  it("refuses a value that is not a cursor", () => {
    expect(code(() => decodeCursor("not-a-cursor", signature, 2))).toBe("format");
  });

  it("refuses a cursor from another version of the format", () => {
    const cursor = encodeCursor(signature, values).replace(/^c1\./, "c2.");

    expect(code(() => decodeCursor(cursor, signature, 2))).toBe("version");
  });

  it("refuses a body that is not JSON", () => {
    expect(code(() => decodeCursor(`${CURSOR_PREFIX}!!!`, signature, 2))).toBe("format");
  });

  it("refuses a payload with no signature", () => {
    const cursor = `${CURSOR_PREFIX}${Buffer.from("[1, 2]").toString("base64url")}`;

    expect(code(() => decodeCursor(cursor, signature, 2))).toBe("format");
  });

  it("refuses a key that is not text", () => {
    const payload = JSON.stringify([signature, 1, "x"]);
    const cursor = `${CURSOR_PREFIX}${Buffer.from(payload).toString("base64url")}`;

    expect(code(() => decodeCursor(cursor, signature, 2))).toBe("format");
  });

  it("refuses a cursor taken under another order", () => {
    const cursor = encodeCursor(keysetSignature("tasks", [keys[1]]), values);

    expect(code(() => decodeCursor(cursor, signature, 2))).toBe("mismatch");
  });

  it("refuses a cursor carrying the wrong number of keys", () => {
    const cursor = encodeCursor(signature, [values[0]]);

    expect(code(() => decodeCursor(cursor, signature, 2))).toBe("mismatch");
  });
});
