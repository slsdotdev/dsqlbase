import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { withSeededClient } from "../fixures/seeded-client";

/**
 * `numeric` read modes against a real database. `ledger_entries.amount` is `numeric(38,6)` read
 * as text, `balance` the same type read as a decimal.js `Decimal`. Both values below have more
 * significant digits than a double holds, so a `number` read would round them.
 */
describe("numeric modes", () => {
  const { getClient, getData } = withSeededClient();

  const EXACT = "12345678901234567.123456";
  const LARGER = "12345678901234567.123457";

  const createEntry = (amount: string | number, balance?: Decimal | string | number | null) =>
    getClient().ledgerEntries.create({
      data: { projectId: getData().projects[0].id, amount, balance },
      return: { id: true, amount: true, balance: true },
    });

  it("reads the exact text, and a Decimal built from it", async () => {
    const entry = await createEntry(EXACT, new Decimal(EXACT));
    const read = await getClient().ledgerEntries.findOne({ where: { id: entry?.id } });

    expect(read?.amount).toBe("12345678901234567.123456");
    expect(read?.balance).toBeInstanceOf(Decimal);
    expect(read?.balance?.toString()).toBe(EXACT);
  });

  it("returns the database's text for a write, scale padding included", async () => {
    const entry = await createEntry(1.5, "2.25");

    expect(entry?.amount).toBe("1.500000");
    expect(entry?.balance?.toFixed(6)).toBe("2.250000");
  });

  it("filters by an exact value, and compares beyond a double's precision", async () => {
    const low = await createEntry(EXACT, new Decimal(EXACT));
    const high = await createEntry(LARGER, new Decimal(LARGER));
    const ids = [low, high].flatMap((entry) => (entry ? [entry.id] : []));

    const byAmount = await getClient().ledgerEntries.findMany({
      where: { amount: EXACT, id: { in: ids } },
    });
    const byBalance = await getClient().ledgerEntries.findMany({
      where: { balance: { gt: new Decimal(EXACT) }, id: { in: ids } },
    });

    expect(byAmount.map((row) => row.id)).toEqual([low?.id]);
    expect(byBalance.map((row) => row.id)).toEqual([high?.id]);
  });

  it("reads exact values in a nested relation select, which travels as JSON", async () => {
    const entry = await createEntry(EXACT, new Decimal(EXACT));

    const project = await getClient().projects.findOne({
      where: { id: getData().projects[0].id },
      select: { id: true, ledgerEntries: { id: true, amount: true, balance: true } },
    });

    const nested = project?.ledgerEntries.find((row) => row.id === entry?.id);

    expect(nested?.amount).toBe(EXACT);
    expect(nested?.balance?.toString()).toBe(EXACT);
  });

  it("refuses a value the scale would round, before the database sees it", () => {
    expect(() => createEntry("1.1234567")).toThrow(/7 decimal places/);
  });
});
