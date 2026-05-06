import { AnySequenceDefinition } from "@dsqlbase/core/definition";
import { describe, expect, it } from "vitest";
import { SerializedObject } from "../../base.js";
import { ValidationContext } from "../context.js";
import { invalidSequenceCache } from "./sequence.js";

type Sequence = SerializedObject<AnySequenceDefinition>;

const sequenceNode = (cache: number | undefined): Sequence =>
  ({
    kind: "SEQUENCE",
    name: "user_id_seq",
    namespace: "public",
    options: {
      dataType: "bigint",
      cache,
      cycle: false,
      increment: 1,
    },
  }) as Sequence;

describe("invalidSequenceCache", () => {
  it("does not report when cache is unset", () => {
    const node = sequenceNode(undefined);
    const context = new ValidationContext([node]);
    invalidSequenceCache(node, context);
    expect(context.issues).toEqual([]);
  });

  it("does not report cache=1", () => {
    const node = sequenceNode(1);
    const context = new ValidationContext([node]);
    invalidSequenceCache(node, context);
    expect(context.issues).toEqual([]);
  });

  it("does not report cache >= 65536", () => {
    const node = sequenceNode(65536);
    const context = new ValidationContext([node]);
    invalidSequenceCache(node, context);
    expect(context.issues).toEqual([]);
  });

  it.each([2, 100, 65535])("reports cache=%i", (cache) => {
    const node = sequenceNode(cache);
    const context = new ValidationContext([node]);
    invalidSequenceCache(node, context);
    expect(context.issues).toHaveLength(1);
    expect(context.issues[0]?.code).toBe("INVALID_SEQUENCE_CACHE");
  });
});
