import { describe, expect, it } from "vitest";
import { sql } from "@dsqlbase/core";
import { withSeededClient } from "../fixures/seeded-client";

describe("transaction operations", () => {
  const { getClient, getData } = withSeededClient();

  describe("callback form", () => {
    it("commits work and persists rows after the callback resolves", async () => {
      const client = getClient();

      await client.$transaction(async (tx) => {
        await (tx as unknown as typeof client).users.create({
          data: { name: "Tx Commit", email: "tx-commit@example.com" },
        });
      });

      const fetched = await client.users.findOne({
        where: { email: { eq: "tx-commit@example.com" } },
      });

      expect(fetched?.name).toBe("Tx Commit");
    });

    it("returns the callback's resolved value", async () => {
      const client = getClient();

      const result = await client.$transaction(async (tx) => {
        const created = await tx.users.create({
          data: { name: "Tx Return", email: "tx-return@example.com" },
          return: { id: true, email: true },
        });
        return created;
      });

      expect(result).toEqual({
        id: expect.any(String),
        email: "tx-return@example.com",
      });
    });

    it("lets a later query inside the same tx observe an earlier insert", async () => {
      const client = getClient();

      const visibleEmail = await client.$transaction(async (tx) => {
        await tx.users.create({
          data: { name: "Tx Read-Your-Write", email: "tx-ryw@example.com" },
        });
        const found = await tx.users.findOne({
          where: { email: { eq: "tx-ryw@example.com" } },
        });
        return found?.email ?? null;
      });

      expect(visibleEmail).toBe("tx-ryw@example.com");
    });

    it("mixes model calls and $query within the same transaction", async () => {
      const client = getClient();

      await client.$transaction(async (tx) => {
        await tx.users.create({
          data: { name: "Tx Mixed", email: "tx-mixed@example.com" },
        });
        await tx.$query(
          sql`UPDATE "users" SET "name" = 'Tx Mixed Updated' WHERE "email" = 'tx-mixed@example.com'`
        );
      });

      const fetched = await client.users.findOne({
        where: { email: { eq: "tx-mixed@example.com" } },
      });
      expect(fetched?.name).toBe("Tx Mixed Updated");
    });

    it("rolls back when the callback throws — the row must not be persisted", async () => {
      const client = getClient();

      await expect(
        client.$transaction(async (tx) => {
          await tx.users.create({
            data: { name: "Tx Rollback", email: "tx-rollback@example.com" },
          });
          throw new Error("force rollback");
        })
      ).rejects.toThrow("force rollback");

      const fetched = await client.users.findOne({
        where: { email: { eq: "tx-rollback@example.com" } },
      });
      expect(fetched).toBeNull();
    });

    it("rolls back when a constraint violation surfaces inside the tx", async () => {
      const client = getClient();
      const data = getData();

      await expect(
        client.$transaction(async (tx) => {
          await tx.users.create({
            data: { name: "Tx Pre-Conflict", email: "tx-preconflict@example.com" },
          });
          await tx.users.create({
            data: { name: "Tx Duplicate", email: data.users[0].email },
          });
        })
      ).rejects.toThrow();

      const fetched = await client.users.findOne({
        where: { email: { eq: "tx-preconflict@example.com" } },
      });
      expect(fetched).toBeNull();
    });
  });

  describe("array form", () => {
    it("commits a batch of executable queries and returns one result per input", async () => {
      const client = getClient();

      const aliceOp = client.users.create({
        data: { name: "Array Alice", email: "array-alice@example.com" },
        return: { id: true, email: true },
      });
      const bobOp = client.users.create({
        data: { name: "Array Bob", email: "array-bob@example.com" },
        return: { id: true, email: true, name: true },
      });

      const result = await client.$transaction([aliceOp, bobOp]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: expect.any(String),
        email: "array-alice@example.com",
      });
      expect(result[1]).toEqual({
        id: expect.any(String),
        email: "array-bob@example.com",
        name: "Array Bob",
      });

      const persisted = await client.users.findMany({
        where: { email: { beginsWith: "array-" } },
        orderBy: { email: "asc" },
      });

      expect(persisted.map((u) => u.email)).toEqual([
        "array-alice@example.com",
        "array-bob@example.com",
      ]);
    });
  });
});
