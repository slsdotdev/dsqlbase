import { describe, expect, it, vi } from "vitest";
import { sql } from "@dsqlbase/core";
import type { Pool, PoolClient } from "pg";
import { PGSession } from "./index.js";

/** A pooled connection whose statements fail as `failures` says, recording each release. */
const fakeConnection = (failures: Partial<Record<string, unknown>> = {}) => {
  const releases: (Error | undefined)[] = [];
  const statements: string[] = [];

  const client = {
    query: vi.fn(async (text: string) => {
      statements.push(text);
      if (text in failures) throw failures[text];
      return { rows: [] };
    }),
    release: vi.fn((error?: Error) => {
      releases.push(error);
    }),
  };

  const pool = { connect: vi.fn(async () => client), query: vi.fn() };

  return {
    session: new PGSession(pool as unknown as Pool),
    client: client as unknown as PoolClient,
    releases,
    statements,
  };
};

/** A failure the server answered: the connection is fine. */
const serverError = (code: string) => Object.assign(new Error(`sqlstate ${code}`), { code });
/** A failure of the connection itself: no SQLSTATE. */
const connectionError = () => new Error("Connection terminated unexpectedly");

describe("PGSession transactions", () => {
  it("commits, returning the connection once; a rollback after is a no-op", async () => {
    const { session, releases, statements } = fakeConnection();

    const tx = await session.beginTransaction();
    await tx.execute(sql`SELECT 1`.toQuery());
    await tx.commit();
    await tx.rollback();

    expect(statements).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    expect(releases).toEqual([undefined]);
  });

  it("returns the connection when BEGIN fails, and throws its error", async () => {
    const error = serverError("08P01");
    const { session, releases } = fakeConnection({ BEGIN: error });

    await expect(session.beginTransaction()).rejects.toBe(error);
    expect(releases).toEqual([undefined]);
  });

  it("destroys the connection when BEGIN fails because it broke", async () => {
    const error = connectionError();
    const { session, releases } = fakeConnection({ BEGIN: error });

    await expect(session.beginTransaction()).rejects.toBe(error);
    expect(releases).toEqual([error]);
  });

  // DSQL reports a conflict at COMMIT; the connection is fine and goes back to the pool.
  it("throws a COMMIT's 40001, returning the connection once", async () => {
    const error = serverError("40001");
    const { session, releases } = fakeConnection({ COMMIT: error });

    const tx = await session.beginTransaction();
    await expect(tx.commit()).rejects.toBe(error);
    await tx.rollback();

    expect(releases).toEqual([undefined]);
  });

  it("destroys the connection when COMMIT fails because it broke", async () => {
    const error = connectionError();
    const { session, releases } = fakeConnection({ COMMIT: error });

    const tx = await session.beginTransaction();
    await expect(tx.commit()).rejects.toBe(error);

    expect(releases).toEqual([error]);
  });

  it("rolls back, returning the connection once", async () => {
    const { session, releases, statements } = fakeConnection();

    const tx = await session.beginTransaction();
    await tx.rollback();
    await tx.rollback();

    expect(statements).toEqual(["BEGIN", "ROLLBACK"]);
    expect(releases).toEqual([undefined]);
  });

  it("doesn't throw when ROLLBACK fails, and destroys the connection", async () => {
    const error = connectionError();
    const { session, releases } = fakeConnection({ ROLLBACK: error });

    const tx = await session.beginTransaction();
    await expect(tx.rollback()).resolves.toBeUndefined();

    expect(releases).toEqual([error]);
  });
});
