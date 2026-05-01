import { describe, expect, it } from "vitest";
import { SequenceDefinition } from "./sequence.js";

describe("SequenceDefinition", () => {
  it("should create with defaults", () => {
    const seq = new SequenceDefinition("order_seq");
    const json = seq.toJSON();

    expect(json.kind).toBe("SEQUENCE");
    expect(json.name).toBe("order_seq");
    expect(json.options.dataType).toBe("bigint");
    expect(json.options.cache).toBe(1);
    expect(json.options.cycle).toBe(false);
    expect(json.options.increment).toBe(1);
    expect(json.options.minValue).toBeUndefined();
    expect(json.options.maxValue).toBeUndefined();
    expect(json.options.startValue).toBeUndefined();
    expect(json.options.ownedBy).toBeUndefined();
  });

  it("should set cache", () => {
    const json = new SequenceDefinition("seq").cache(65536).toJSON();
    expect(json.options.cache).toBe(65536);
  });

  it("should set cycle", () => {
    const json = new SequenceDefinition("seq").cycle().toJSON();
    expect(json.options.cycle).toBe(true);
  });

  it("should set increment", () => {
    const json = new SequenceDefinition("seq").incrementBy(5).toJSON();
    expect(json.options.increment).toBe(5);
  });

  it("should set min and max values", () => {
    const json = new SequenceDefinition("seq").minValue(1).maxValue(9999).toJSON();
    expect(json.options.minValue).toBe(1);
    expect(json.options.maxValue).toBe(9999);
  });

  it("should set start value", () => {
    const json = new SequenceDefinition("seq").startWith(1000).toJSON();
    expect(json.options.startValue).toBe(1000);
  });

  it("should serialize all options together", () => {
    const json = new SequenceDefinition("invoice_seq")
      .cache(65536)
      .incrementBy(1)
      .startWith(1000)
      .minValue(1)
      .maxValue(999999)
      .cycle()
      .toJSON();

    expect(json).toMatchObject({
      kind: "SEQUENCE",
      name: "invoice_seq",
      options: {
        dataType: "bigint",
        cache: 65536,
        cycle: true,
        increment: 1,
        minValue: 1,
        maxValue: 999999,
        startValue: 1000,
        ownedBy: undefined,
      },
    });
  });
});
