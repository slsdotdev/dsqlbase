import { describe, expect, it } from "vitest";
import { diffDomainOperations } from "./domain.js";
import { SerializedObject } from "../../base.js";
import { AnyDomainDefinition } from "@dsqlbase/core/definition";

type Domain = SerializedObject<AnyDomainDefinition>;

const baseDomain: Domain = {
  kind: "DOMAIN",
  name: "email",
  namespace: "public",
  dataType: "text",
  notNull: false,
  defaultValue: undefined,
  check: undefined,
} as Domain;

describe("diffDomainOperations — existing remote", () => {
  it("emits ALTER DOMAIN SET DEFAULT when default is added", () => {
    const local: Domain = { ...baseDomain, defaultValue: "''" };

    const result = diffDomainOperations(local, baseDomain);

    expect(result.errors).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      type: "ALTER",
      statement: {
        __kind: "ALTER_DOMAIN",
        name: "email",
        action: { __kind: "SET_DEFAULT", expression: "''" },
      },
    });
  });

  it("emits ALTER DOMAIN DROP DEFAULT when default is removed", () => {
    const remote: Domain = { ...baseDomain, defaultValue: "''" };

    const result = diffDomainOperations(baseDomain, remote);

    expect(result.errors).toEqual([]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].statement).toMatchObject({
      __kind: "ALTER_DOMAIN",
      action: { __kind: "DROP_DEFAULT" },
    });
  });

  it("emits ALTER DOMAIN SET DEFAULT when default is modified", () => {
    const remote: Domain = { ...baseDomain, defaultValue: "''" };
    const local: Domain = { ...baseDomain, defaultValue: "'unknown'" };

    const result = diffDomainOperations(local, remote);

    expect(result.errors).toEqual([]);
    expect(result.operations[0].statement).toMatchObject({
      action: { __kind: "SET_DEFAULT", expression: "'unknown'" },
    });
  });

  it("refuses dataType change with IMMUTABLE_DOMAIN", () => {
    const local: Domain = { ...baseDomain, dataType: "varchar" };

    const result = diffDomainOperations(local, baseDomain);

    expect(result.operations).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: "IMMUTABLE_DOMAIN",
      subject: "email",
    });
    expect(result.errors[0].message).toContain("dataType");
  });

  it("refuses notNull change with IMMUTABLE_DOMAIN", () => {
    const local: Domain = { ...baseDomain, notNull: true };

    const result = diffDomainOperations(local, baseDomain);

    expect(result.operations).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: "IMMUTABLE_DOMAIN",
      subject: "email",
    });
  });

  it("refuses check change with IMMUTABLE_DOMAIN", () => {
    const local: Domain = {
      ...baseDomain,
      check: { kind: "CHECK_CONSTRAINT", name: "email_format", expression: "VALUE ~ '@'" },
    };

    const result = diffDomainOperations(local, baseDomain);

    expect(result.operations).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: "IMMUTABLE_DOMAIN",
      subject: "email",
    });
  });

  it("returns kind mismatch error when remote is wrong kind", () => {
    const result = diffDomainOperations(baseDomain, {
      kind: "TABLE",
      name: "email",
    } as never);

    expect(result.operations).toEqual([]);
    expect(result.errors[0].code).toBe("KIND_MISMATCH");
  });
});
