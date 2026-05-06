import { describe, expect, it } from "vitest";
import { diffDomain } from "./domain.js";

type Domain = Parameters<typeof diffDomain>[0];

const baseDomain: Domain = {
  kind: "DOMAIN",
  name: "email",
  namespace: "public",
  dataType: "text",
  notNull: false,
  defaultValue: undefined,
  check: undefined,
};

const checkA = {
  kind: "CHECK_CONSTRAINT",
  name: "email_format",
  expression: "VALUE ~ '@'",
} as const;
const checkB = {
  kind: "CHECK_CONSTRAINT",
  name: "email_strict",
  expression: "VALUE ~ '^.+@.+$'",
} as const;

describe("diffDomain", () => {
  it("emits no diffs when local and remote are identical", () => {
    expect(diffDomain(baseDomain, baseDomain)).toEqual([]);
  });

  it.each([
    ["dataType", { dataType: "varchar(255)" }],
    ["notNull", { notNull: true }],
    ["defaultValue", { defaultValue: "''" }],
  ])("emits one diff entry for %s", (key, override) => {
    const local: Domain = { ...baseDomain, ...(override as Partial<Domain>) };
    const diffs = diffDomain(local, baseDomain);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ key });
  });

  describe("CHECK constraint (name-only equality)", () => {
    it("emits no diff when names match but expressions differ", () => {
      const local: Domain = { ...baseDomain, check: { ...checkA, expression: "VALUE ~ '@'" } };
      const remote: Domain = {
        ...baseDomain,
        check: { ...checkA, expression: "(VALUE ~ '@'::text)" },
      };
      expect(diffDomain(local, remote)).toEqual([]);
    });

    it("emits no diff when both name and expression are identical", () => {
      const local: Domain = { ...baseDomain, check: checkA };
      const remote: Domain = { ...baseDomain, check: checkA };
      expect(diffDomain(local, remote)).toEqual([]);
    });

    it("emits modify when names differ", () => {
      const local: Domain = { ...baseDomain, check: checkA };
      const remote: Domain = { ...baseDomain, check: checkB };
      const diffs = diffDomain(local, remote);

      expect(diffs).toEqual([
        {
          type: "modify",
          kind: "DOMAIN",
          name: local.name,
          object: local,
          key: "check",
          value: checkA,
          prevValue: checkB,
        },
      ]);
    });

    it("emits an add when only local has a check", () => {
      const local: Domain = { ...baseDomain, check: checkA };
      const diffs = diffDomain(local, baseDomain);
      expect(diffs).toEqual([
        {
          type: "add",
          kind: "DOMAIN",
          name: local.name,
          object: local,
          key: "check",
          value: checkA,
          prevValue: undefined,
        },
      ]);
    });

    it("emits a remove when only remote has a check", () => {
      const remote: Domain = { ...baseDomain, check: checkA };
      const diffs = diffDomain(baseDomain, remote);
      expect(diffs).toEqual([
        {
          type: "remove",
          kind: "DOMAIN",
          name: baseDomain.name,
          object: baseDomain,
          key: "check",
          value: undefined,
          prevValue: checkA,
        },
      ]);
    });
  });
});
