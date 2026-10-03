import { describe, expect, it } from "vitest";
import { deriveIdentifier, postgresObjectName } from "./names.js";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("deriveIdentifier", () => {
  it("joins base and suffix when the result fits in 63 bytes", () => {
    expect(deriveIdentifier("users_email_idx", "rebuild")).toBe("users_email_idx_rebuild");
  });

  // The server truncates a longer name silently; the next plan would not recognise it.
  it("keeps a long name within 63 bytes, ending in a fingerprint and the suffix", () => {
    const base = "customer_billing_addresses_v2_secondary_postal_code_value_lookup";
    const name = deriveIdentifier(base, "rebuild");

    expect(bytes(name)).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^customer_billing_addresses_v2_.*_[0-9a-f]{8}_rebuild$/);
  });

  it("derives the same name from the same input, and different names from different inputs", () => {
    const base = "a".repeat(60);

    expect(deriveIdentifier(base, "idx")).toBe(deriveIdentifier(base, "idx"));
    expect(deriveIdentifier(`${base}1`, "idx")).not.toBe(deriveIdentifier(`${base}2`, "idx"));
  });

  it("cuts a multi-byte base on a character boundary", () => {
    const name = deriveIdentifier("é".repeat(40), "idx");

    expect(bytes(name)).toBeLessThanOrEqual(63);
    expect(name).not.toContain("�");
    expect(name.startsWith("é")).toBe(true);
  });
});

// Expected names are what PostgreSQL chose for an inline UNIQUE on PGlite (2026-10-03).
describe("postgresObjectName", () => {
  it.each([
    ["users", "email", "users_email_key"],
    [
      "customer_billing_addresses_v2",
      "secondary_postal_code_value",
      "customer_billing_addresses_v2_secondary_postal_code_value_key",
    ],
    ["t".repeat(50), "c".repeat(20), `${"t".repeat(38)}_${"c".repeat(20)}_key`],
    ["a".repeat(20), "b".repeat(60), `${"a".repeat(20)}_${"b".repeat(38)}_key`],
    ["tébléé".repeat(8), "cölümn".repeat(6), "tébléétébléétébléét_cölümncölümncölümncöl_key"],
  ])("names %s / %s as PostgreSQL does", (table, column, expected) => {
    expect(postgresObjectName(table, column, "key")).toBe(expected);
  });

  // The review's repro: 66 bytes untrimmed, which the server cut to `…_not_n`.
  it("keeps a NOT NULL CHECK name within 63 bytes, ending in its label", () => {
    const name = postgresObjectName(
      "customer_billing_addresses_v2",
      "secondary_postal_code_value",
      "not_null"
    );

    expect(bytes(name)).toBeLessThanOrEqual(63);
    expect(name.endsWith("_not_null")).toBe(true);
  });
});
