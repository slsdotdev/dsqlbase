import { describe, expect, it } from "vitest";
import { deriveIdentifier } from "./base.js";

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
