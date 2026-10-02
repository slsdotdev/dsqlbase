import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SQLStatement } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { table, text, uuid } from "../../schema/index.js";

describe("RequestNormalizer read-only columns", () => {
  const invoices = table("invoices", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().readOnly(),
    number: text("number").notNull(),
  });

  let calls: SQLStatement[];
  let dsql: ReturnType<typeof createClient<{ invoices: typeof invoices }>>;

  beforeEach(() => {
    calls = [];
    const session = {
      execute: vi.fn(async (query: SQLStatement) => {
        calls.push(query);
        return [];
      }),
    } as unknown as Session;

    dsql = createClient({ schema: { invoices }, session });
  });

  // The field is not in `CreateValuesOf`, so it can only arrive through an untyped spread.
  // Dropping it keeps `create({ data: { ...input } })` working; refusing it would not.
  it("drops a read-only field from create data", async () => {
    await dsql.invoices.create({
      data: { number: "INV-1", workspaceId: "ws-1" } as { number: string },
    });

    expect(calls[0]?.params).toEqual(["INV-1"]);
    expect(calls[0]?.text).not.toContain("$2");
  });

  it("drops a read-only field from update set", async () => {
    await dsql.invoices.update({
      set: { number: "INV-2", workspaceId: "ws-2" } as { number: string },
      where: { number: { eq: "INV-1" } },
    });

    expect(calls[0]?.params).toEqual(["INV-2", "INV-1"]);
  });

  it("keeps a read-only column filterable, selectable and orderable", async () => {
    await dsql.invoices.findMany({
      select: { workspaceId: true },
      where: { workspaceId: { eq: "ws-1" } },
      orderBy: { workspaceId: "asc" },
    });

    expect(calls[0]?.text).toContain(`"workspace_id"`);
    expect(calls[0]?.params).toEqual(["ws-1"]);
  });
});
