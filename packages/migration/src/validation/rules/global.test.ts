import { describe, expect, it } from "vitest";
import { ValidationContext } from "../context.js";
import { identifierTooLong, noDuplicateObjectNames } from "./global.js";
import { SerializedSchema } from "../../base.js";

const tableNode = (name: string, namespace = "public") =>
  ({
    kind: "TABLE",
    name,
    namespace,
    columns: [],
    indexes: [],
    constraints: [],
  }) as unknown as SerializedSchema[number];

const sequenceNode = (name: string, namespace = "public") =>
  ({
    kind: "SEQUENCE",
    name,
    namespace,
    options: { dataType: "bigint", cache: 1, cycle: false, increment: 1 },
  }) as unknown as SerializedSchema[number];

describe("noDuplicateObjectNames", () => {
  it("reports nothing for unique names", () => {
    const schema: SerializedSchema = [tableNode("users"), tableNode("teams")];
    const context = new ValidationContext(schema);
    noDuplicateObjectNames(schema, context);
    expect(context.issues).toEqual([]);
  });

  it("reports a duplicate within the same namespace", () => {
    const schema: SerializedSchema = [tableNode("users"), tableNode("users")];
    const context = new ValidationContext(schema);
    noDuplicateObjectNames(schema, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("DUPLICATE_OBJECT_NAME");
  });

  it("ignores duplicates across different namespaces", () => {
    const schema: SerializedSchema = [tableNode("users", "public"), tableNode("users", "billing")];
    const context = new ValidationContext(schema);
    noDuplicateObjectNames(schema, context);
    expect(context.issues).toEqual([]);
  });
});

describe("identifierTooLong", () => {
  it("does not report names within the 63-byte limit", () => {
    const node = sequenceNode("a".repeat(63));
    const context = new ValidationContext([node]);
    identifierTooLong(node, context);
    expect(context.issues).toEqual([]);
  });

  it("reports identifiers longer than 63 bytes", () => {
    const node = sequenceNode("a".repeat(64));
    const context = new ValidationContext([node]);
    identifierTooLong(node, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("IDENTIFIER_TOO_LONG");
  });

  it("counts UTF-8 bytes, not characters", () => {
    const node = sequenceNode("é".repeat(32));
    const context = new ValidationContext([node]);
    identifierTooLong(node, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("IDENTIFIER_TOO_LONG");
  });
});
