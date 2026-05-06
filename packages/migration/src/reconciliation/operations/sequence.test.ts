import { describe, expect, it } from "vitest";
import { diffSequenceOperations } from "./sequence.js";
import { SerializedObject } from "../../base.js";
import { AnySequenceDefinition } from "@dsqlbase/core/definition";

type Sequence = SerializedObject<AnySequenceDefinition>;

const baseSequence: Sequence = {
  kind: "SEQUENCE",
  name: "task_number_seq",
  namespace: "public",
  options: {
    dataType: "bigint",
    cache: 1,
    cycle: false,
    increment: 1,
    minValue: 1,
    maxValue: 1_000_000,
    startValue: 1,
    ownedBy: undefined,
  },
} as Sequence;

describe("diffSequenceOperations", () => {
  it("emits CREATE SEQUENCE when remote is absent", () => {
    const result = diffSequenceOperations(baseSequence, undefined);

    expect(result.errors).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      type: "CREATE",
      statement: { __kind: "CREATE_SEQUENCE", name: "task_number_seq" },
    });
  });

  it("emits ALTER SEQUENCE when options change", () => {
    const local: Sequence = {
      ...baseSequence,
      options: { ...baseSequence.options, increment: 5 },
    };

    const result = diffSequenceOperations(local, baseSequence);

    expect(result.errors).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      type: "ALTER",
      statement: {
        __kind: "ALTER_SEQUENCE",
        name: "task_number_seq",
        options: expect.objectContaining({ incrementBy: 5 }),
      },
    });
  });

  it("emits no operations when local equals remote", () => {
    const result = diffSequenceOperations(baseSequence, baseSequence);

    expect(result.errors).toEqual([]);
    expect(result.operations).toEqual([]);
  });

  it("returns kind mismatch when remote is wrong kind", () => {
    const result = diffSequenceOperations(baseSequence, {
      kind: "TABLE",
      name: "task_number_seq",
    } as never);

    expect(result.operations).toEqual([]);
    expect(result.errors[0].code).toBe("KIND_MISMATCH");
  });
});
