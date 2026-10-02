import { describe, expect, it } from "vitest";
import { ValidationContext } from "../context.js";
import { duplicateSequenceName, identifierTooLong, noDuplicateObjectNames } from "./global.js";
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

const identityTable = (
  name: string,
  sequenceNames: (string | undefined)[],
  namespace = "public",
  indexes: string[] = []
) =>
  ({
    kind: "TABLE",
    name,
    namespace,
    columns: sequenceNames.map((sequenceName, index) => ({
      kind: "COLUMN",
      name: `c${index}`,
      dataType: "bigint",
      identity: {
        type: "ALWAYS",
        sequenceName,
        options: { dataType: "bigint", cache: 1, cycle: false, increment: 1 },
      },
    })),
    indexes: indexes.map((index) => ({ kind: "INDEX", name: index })),
    constraints: [],
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

describe("duplicateSequenceName", () => {
  const run = (schema: SerializedSchema) => {
    const context = new ValidationContext(schema);
    duplicateSequenceName(schema, context);
    return context.issues;
  };

  it("reports nothing for identities without a sequence name", () => {
    expect(
      run([identityTable("a", [undefined, undefined]), identityTable("b", [undefined])])
    ).toEqual([]);
  });

  it("reports nothing for distinct sequence names", () => {
    expect(run([identityTable("a", ["a_seq"]), identityTable("b", ["b_seq"])])).toEqual([]);
  });

  it("reports two identities sharing a sequence name", () => {
    const issues = run([identityTable("a", ["shared_seq"]), identityTable("b", ["shared_seq"])]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("DUPLICATE_SEQUENCE_NAME");
    expect(issues[0]?.path).toEqual(["public", "b", "columns", "c0"]);
  });

  it("reports two identities on one table sharing a sequence name", () => {
    const issues = run([identityTable("a", ["shared_seq", "shared_seq"])]);

    expect(issues.map((issue) => issue.code)).toEqual(["DUPLICATE_SEQUENCE_NAME"]);
  });

  it("reports a sequence name taken by a sequence, a table or an index", () => {
    const issues = run([
      sequenceNode("counter"),
      tableNode("users"),
      identityTable("a", ["counter", "users", "a_idx"], "public", ["a_idx"]),
    ]);

    expect(issues.map((issue) => issue.path.at(-1))).toEqual(["c0", "c1", "c2"]);
  });

  it("ignores the same sequence name in another namespace", () => {
    expect(
      run([identityTable("a", ["shared_seq"]), identityTable("b", ["shared_seq"], "billing")])
    ).toEqual([]);
  });
});
