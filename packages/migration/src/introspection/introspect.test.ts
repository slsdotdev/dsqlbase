import type { Session } from "@dsqlbase/core/runtime";
import { describe, expect, it, vi } from "vitest";
import { introspect } from "./introspect.js";

function mockSession(definitions: unknown[]): Session {
  return {
    execute: vi.fn().mockResolvedValue([{ definitions }]),
  } as unknown as Session;
}

describe("introspect", () => {
  it("normalizes rows and sorts by ORDERED_SCHEMA_OBJECTS", async () => {
    const session = mockSession([
      {
        kind: "TABLE",
        name: "widgets",
        namespace: "public",
        columns: [],
        indexes: [],
        constraints: [],
      },
      { kind: "SCHEMA", name: "billing" },
      {
        kind: "DOMAIN",
        name: "status",
        namespace: "public",
        dataType: "text",
        notNull: false,
        defaultValue: null,
        check: null,
      },
    ]);

    const result = await introspect(session);

    expect(result.map((row) => row.kind)).toEqual(["SCHEMA", "DOMAIN", "TABLE"]);
  });

  it("drops VIEW and FUNCTION rows", async () => {
    const session = mockSession([
      { kind: "VIEW", name: "v", namespace: "public" },
      { kind: "FUNCTION", name: "f", namespace: "public" },
      { kind: "SCHEMA", name: "billing" },
    ]);

    const result = await introspect(session);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "SCHEMA", name: "billing" });
  });

  it("returns an empty schema when the query yields no rows", async () => {
    const session = mockSession([]);
    const result = await introspect(session);
    expect(result).toEqual([]);
  });
});
