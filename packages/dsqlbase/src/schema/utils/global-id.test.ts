import { describe, expect, it } from "vitest";
import {
  GLOBAL_ID_PREFIX,
  GlobalIdError,
  decodeGlobalId,
  encodeGlobalId,
  isGlobalId,
} from "./global-id.js";

const UUID = "3f1c0e3e-0a3f-4a1e-9c2e-8b5f1d2a7c44";

/** A wrapped value with a payload of our choosing, for the malformed-input cases. */
function wrap(payload: unknown): string {
  return `${GLOBAL_ID_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

describe("encodeGlobalId / decodeGlobalId", () => {
  it("should round-trip a key and its primary key", () => {
    const id = encodeGlobalId("users", { id: UUID });

    expect(id.startsWith(GLOBAL_ID_PREFIX)).toBe(true);
    expect(decodeGlobalId(id)).toEqual({ key: "users", pk: { id: UUID } });
  });

  it("should produce a url-safe value", () => {
    // base64url, so an id can sit in a path segment or a query string untouched.
    const id = encodeGlobalId("teams", { id: UUID });

    expect(id.slice(GLOBAL_ID_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should carry the field name rather than assuming `id`", () => {
    const id = encodeGlobalId("members", { membershipId: UUID });

    expect(decodeGlobalId(id).pk).toEqual({ membershipId: UUID });
  });

  it("should round-trip a multi-field payload", () => {
    // Nothing produces one today — only a single-column `guid()` key can be declared — but the
    // format names its fields, so it will not have to change if that ever lands.
    const id = encodeGlobalId("memberships", { teamId: UUID, userId: UUID });

    expect(decodeGlobalId(id)).toEqual({ key: "memberships", pk: { teamId: UUID, userId: UUID } });
  });

  it("should give different keys different ids for the same row value", () => {
    expect(encodeGlobalId("users", { id: UUID })).not.toBe(encodeGlobalId("teams", { id: UUID }));
  });
});

describe("decodeGlobalId / malformed input", () => {
  it.each([
    ["a raw uuid", UUID],
    ["an empty string", ""],
    ["the prefix alone", GLOBAL_ID_PREFIX],
    ["base64 that is not JSON", `${GLOBAL_ID_PREFIX}bm90IGpzb24`],
    ["a payload that is not an array", wrap({ key: "users", pk: { id: UUID } })],
    ["a payload of the wrong arity", wrap(["users"])],
    ["a key that is not a string", wrap([1, { id: UUID }])],
    ["an empty key", wrap(["", { id: UUID }])],
    ["a pk that is not an object", wrap(["users", UUID])],
    ["a pk that is an array", wrap(["users", [UUID]])],
    ["an empty pk", wrap(["users", {}])],
    ["a non-string key value", wrap(["users", { id: 7 }])],
  ])("should reject %s", (_label, value) => {
    expect(() => decodeGlobalId(value)).toThrow(GlobalIdError);
    expect(() => decodeGlobalId(value)).toThrow(expect.objectContaining({ code: "format" }));
  });

  it("should reject an id from another table when a key is expected", () => {
    const id = encodeGlobalId("workspaces", { id: UUID });

    expect(() => decodeGlobalId(id, "users")).toThrow(
      expect.objectContaining({ code: "key_mismatch" })
    );
    // The message names both sides, because "wrong table" is useless without them.
    expect(() => decodeGlobalId(id, "users")).toThrow(/"workspaces".*"users"/);
  });

  it("should accept an id whose key is the expected one", () => {
    const id = encodeGlobalId("users", { id: UUID });

    expect(decodeGlobalId(id, "users").pk).toEqual({ id: UUID });
  });
});

describe("isGlobalId", () => {
  it.each([
    [encodeGlobalId("users", { id: UUID }), true],
    [UUID, false],
    ["", false],
    ["guid", false],
    [GLOBAL_ID_PREFIX, true],
  ])("should report %s as %s", (value, expected) => {
    expect(isGlobalId(value)).toBe(expected);
  });

  it("should reject non-strings", () => {
    expect(isGlobalId(undefined)).toBe(false);
    expect(isGlobalId(null)).toBe(false);
    expect(isGlobalId(7)).toBe(false);
  });
});
