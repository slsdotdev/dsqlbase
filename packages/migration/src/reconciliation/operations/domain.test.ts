import { describe, expect, it } from "vitest";
import { diffDomainOperations } from "./domain.js";
import { createPrinter } from "../../ddl/index.js";

const print = createPrinter();
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
    expect(result.operations[0]?.summary).toMatchObject({
      subject: { kind: "DOMAIN", name: "email" },
      action: "DROP",
      target: { kind: "DEFAULT", name: "email" },
      risk: "lossy",
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
    expect(result.operations[0]?.summary).toMatchObject({
      action: "ALTER",
      changes: [{ attribute: "defaultValue", from: "''", to: "'unknown'" }],
      risk: "safe",
    });
  });

  const check = {
    kind: "CHECK_CONSTRAINT",
    name: "email_format",
    expression: "VALUE ~ '@'",
    validated: true,
  } as const;
  const sqlOf = (local: Domain, remote: Domain) =>
    diffDomainOperations(local, remote).operations.map((op) => print(op.statement).text);

  it("refuses a type change: NO_ALTER_DOMAIN_TYPE", () => {
    const result = diffDomainOperations({ ...baseDomain, dataType: "varchar" }, baseDomain);

    expect(result.operations).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "NO_ALTER_DOMAIN_TYPE", subject: "email" }),
    ]);
    expect(result.errors[0]?.message).toMatch(/new domain/);
  });

  it("refuses SET NOT NULL: NO_ALTER_DOMAIN_CONSTRAINT", () => {
    const result = diffDomainOperations({ ...baseDomain, notNull: true }, baseDomain);

    expect(result.errors).toEqual([
      expect.objectContaining({ code: "NO_ALTER_DOMAIN_CONSTRAINT", subject: "email" }),
    ]);
  });

  it("drops NOT NULL (destructive: DSQL can't set it again)", () => {
    const result = diffDomainOperations(baseDomain, { ...baseDomain, notNull: true });

    expect(sqlOf(baseDomain, { ...baseDomain, notNull: true })).toEqual([
      `ALTER DOMAIN "public"."email" DROP NOT NULL`,
    ]);
    expect(result.operations[0]?.summary).toMatchObject({ action: "DROP", risk: "destructive" });
  });

  it("refuses adding or renaming a CHECK: NO_ALTER_DOMAIN_CONSTRAINT", () => {
    const added = diffDomainOperations({ ...baseDomain, check }, baseDomain);
    const renamed = diffDomainOperations(
      { ...baseDomain, check: { ...check, name: "email_has_at" } },
      { ...baseDomain, check }
    );

    for (const result of [added, renamed]) {
      expect(result.operations).toEqual([]);
      expect(result.errors).toEqual([
        expect.objectContaining({ code: "NO_ALTER_DOMAIN_CONSTRAINT" }),
      ]);
    }
  });

  it("drops a removed CHECK (destructive: DSQL can't add it back)", () => {
    expect(sqlOf(baseDomain, { ...baseDomain, check })).toEqual([
      `ALTER DOMAIN "public"."email" DROP CONSTRAINT IF EXISTS "email_format" RESTRICT`,
    ]);
    expect(
      diffDomainOperations(baseDomain, { ...baseDomain, check }).operations[0]?.summary.risk
    ).toBe("destructive");
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
