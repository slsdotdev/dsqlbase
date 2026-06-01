import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@dsqlbase/core";
import { createClient } from "../create.js";
import { ModelClient } from "../model/client.js";
import { belongsTo, hasMany, relations, table, text, uuid } from "../../schema/index.js";
import { TxClient } from "./transaction-client.js";

const users = table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
});

const posts = table("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
});

const userRelations = relations(users, {
  posts: hasMany(posts, {
    from: [users.columns.id],
    to: [posts.columns.userId],
  }),
});

const postRelations = relations(posts, {
  author: belongsTo(users, {
    from: [posts.columns.userId],
    to: [users.columns.id],
  }),
});

const schema = { users, posts, userRelations, postRelations };

const createMockSession = () => {
  const txSessions: {
    execute: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    execute: vi.fn().mockResolvedValue([]),
    beginTransaction: vi.fn(async () => {
      const tx = {
        execute: vi.fn().mockResolvedValue([]),
        commit: vi.fn().mockResolvedValue(null),
        rollback: vi.fn().mockResolvedValue(null),
      };
      txSessions.push(tx);
      return tx;
    }),
    txSessions,
  };
};

describe("createTransactionRunner via $transaction", () => {
  let session: ReturnType<typeof createMockSession>;
  let dsql: ReturnType<typeof createClient<typeof schema>>;

  beforeEach(() => {
    session = createMockSession();
    dsql = createClient({ schema, session });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("capability check", () => {
    it("rejects when the session does not support transactions", async () => {
      const sessionNoTx: Session = {
        execute: vi.fn(),
      };

      const noTxClient = createClient({ schema, session: sessionNoTx });

      await expect(noTxClient.$transaction(async () => 1)).rejects.toThrow(
        "Session does not support transactions"
      );
    });
  });

  describe("begin & commit lifecycle", () => {
    it("calls session.beginTransaction exactly once on a successful tx", async () => {
      await dsql.$transaction(async () => "ok");

      expect(session.beginTransaction).toHaveBeenCalledTimes(1);
      expect(session.txSessions).toHaveLength(1);
      expect(session.txSessions[0].commit).toHaveBeenCalledTimes(1);
      expect(session.txSessions[0].rollback).not.toHaveBeenCalled();
    });
  });

  describe("array form", () => {
    it("executes every query against the tx session (not the outer session) and commits once", async () => {
      const op1 = dsql.users.create({
        data: { name: "Alice", email: "alice@example.com" },
      });
      const op2 = dsql.users.create({
        data: { name: "Bob", email: "bob@example.com" },
      });

      await dsql.$transaction([op1, op2]);
      const tx = session.txSessions[0];

      expect(tx).toBeDefined();
      expect(tx.execute).toHaveBeenCalledTimes(2);
      expect(session.execute).not.toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalledTimes(1);
    });

    it("returns an array with one entry per input op, in order", async () => {
      const op1 = dsql.users.create({
        data: { name: "Alice", email: "alice@example.com" },
      });
      const op2 = dsql.users.create({
        data: { name: "Bob", email: "bob@example.com" },
      });

      const result = await dsql.$transaction([op1, op2]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe("callback form", () => {
    it("passes a client with a ModelClient for every table", async () => {
      let txClient = {} as TxClient<typeof schema>;

      await dsql.$transaction(async (tx) => {
        txClient = tx;
        return null;
      });

      expect(txClient.users).toBeInstanceOf(ModelClient);
      expect(txClient.posts).toBeInstanceOf(ModelClient);
    });

    it("returns the callback's resolved value", async () => {
      const result = await dsql.$transaction(async () => ({ ok: true, count: 7 }));
      expect(result).toEqual({ ok: true, count: 7 });
    });

    it("routes model queries inside the callback through the tx session", async () => {
      await dsql.$transaction(async (tx) => {
        await (tx as unknown as typeof dsql).users.create({
          data: { name: "Alice", email: "alice@example.com" },
        });
      });

      const txSession = session.txSessions[0];
      expect(txSession.execute).toHaveBeenCalledTimes(1);
      expect(session.execute).not.toHaveBeenCalled();
      expect(txSession.commit).toHaveBeenCalledTimes(1);
    });
  });

  describe("error propagation", () => {
    it("propagates a non-OCC error from the callback", async () => {
      const err = new Error("boom");

      await expect(
        dsql.$transaction(async () => {
          throw err;
        })
      ).rejects.toBe(err);
    });

    it("rolls back when the callback throws a non-OCC error", async () => {
      await expect(
        dsql.$transaction(async () => {
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");

      const tx = session.txSessions[0];
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it("retries the callback on an OCC (40001) error and resolves once it succeeds", async () => {
      let calls = 0;
      const result = await dsql.$transaction(async () => {
        calls += 1;
        if (calls === 1) {
          throw { code: "40001", message: "serialization_failure" };
        }
        return "second-try";
      });

      expect(result).toBe("second-try");
      expect(calls).toBe(2);
    });

    it("begins a fresh transaction on each OCC retry", async () => {
      let calls = 0;
      await dsql.$transaction(async () => {
        calls += 1;
        if (calls === 1) {
          throw { code: "40001", message: "serialization_failure" };
        }
        return null;
      });

      expect(session.beginTransaction).toHaveBeenCalledTimes(2);
      expect(session.txSessions).toHaveLength(2);
    });
  });
});
