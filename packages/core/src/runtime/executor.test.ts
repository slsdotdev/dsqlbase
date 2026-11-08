import { describe, expect, it, vi } from "vitest";
import { sql } from "../sql/index.js";
import { CompositeQuery, ExecutableQuery } from "./executor.js";
import { AnyOperation } from "./operation.js";
import { Session } from "./session.js";
import { PolicyViolationError } from "./errors.js";

const operationReturning = (text: string): AnyOperation => ({
  type: "select",
  mode: "many",
  name: text,
  args: {},
  query: sql`${sql.raw(text)}`.toQuery(),
  resolve: (rows) => rows,
});

const sessionAnswering = (answer: (text: string) => unknown[]) =>
  ({
    execute: vi.fn(async ({ text }: { text: string }) => answer(text)),
  }) as unknown as Session & { execute: ReturnType<typeof vi.fn> };

describe("ExecutableQuery", () => {
  it("runs its statement on the session it was cloned onto", async () => {
    const original = sessionAnswering(() => ["original"]);
    const other = sessionAnswering(() => ["other"]);

    const query = new ExecutableQuery<string[]>(operationReturning("SELECT 1"), original);

    await expect(query.clone(other).execute()).resolves.toEqual(["other"]);
    expect(original.execute).not.toHaveBeenCalled();
  });
});

describe("ExecutableQuery / policy violations", () => {
  const failingWith = (message: string, code?: string) =>
    ({
      execute: vi.fn(async () => {
        throw Object.assign(new Error(message), code ? { code } : {});
      }),
    }) as unknown as Session;

  const update = (session: Session) =>
    new ExecutableQuery({ ...operationReturning("UPDATE"), type: "update" }, session);

  it("decodes a failed check into a PolicyViolationError, the driver error as cause", async () => {
    const driverError =
      'invalid input syntax for type integer: "dsqlbase.policy:docs:restrictive:ws"';
    const error = await update(failingWith(driverError, "22P02"))
      .execute()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PolicyViolationError);
    expect(error).toMatchObject({
      table: "docs",
      command: "update",
      as: "restrictive",
      policies: ["ws"],
      message: 'Row policy refused the update on "docs": restrictive policy "ws" failed.',
    });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("reads the message alone, so a session that drops the code still decodes", async () => {
    const error = await update(
      failingWith(
        'invalid input syntax for type integer: "dsqlbase.policy:docs:permissive:own,shared"'
      )
    )
      .execute()
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      as: "permissive",
      policies: ["own", "shared"],
      message:
        'Row policy refused the update on "docs": no permissive policy passed ("own", "shared").',
    });
  });

  it("says so when no permissive policy covers the command", async () => {
    const error = await update(
      failingWith('invalid input syntax for type integer: "dsqlbase.policy:docs:permissive:"')
    )
      .execute()
      .catch((e: unknown) => e);

    expect((error as Error).message).toBe(
      'Row policy refused the update on "docs": no permissive policy applies to update.'
    );
  });

  it("leaves any other error alone", async () => {
    await expect(update(failingWith("deadlock", "40001")).execute()).rejects.toThrow("deadlock");
    await expect(
      update(failingWith('invalid input syntax for type integer: "abc"', "22P02")).execute()
    ).rejects.not.toBeInstanceOf(PolicyViolationError);
  });
});

describe("CompositeQuery", () => {
  const partsOn = (session: Session) =>
    [
      new ExecutableQuery<string[]>(operationReturning("page"), session),
      new ExecutableQuery<string[]>(operationReturning("count"), session),
    ] as const;

  it("runs every part and combines their results in order", async () => {
    const session = sessionAnswering((text) => [text]);

    const query = new CompositeQuery(partsOn(session), ([page, count]) => ({ page, count }));

    await expect(query).resolves.toEqual({ page: ["page"], count: ["count"] });
    expect(session.execute).toHaveBeenCalledTimes(2);
  });

  it("re-binds every part when cloned onto another session", async () => {
    const original = sessionAnswering(() => ["original"]);
    const other = sessionAnswering((text) => [`other:${text}`]);

    const query = new CompositeQuery(partsOn(original), ([page, count]) => [...page, ...count]);

    await expect(query.clone(other).execute()).resolves.toEqual(["other:page", "other:count"]);
    expect(original.execute).not.toHaveBeenCalled();
  });

  it("rejects when any part does", async () => {
    const session = sessionAnswering((text) => {
      if (text === "count") throw new Error("count failed");
      return [text];
    });

    const query = new CompositeQuery(partsOn(session), (results) => results);

    await expect(query.execute()).rejects.toThrow("count failed");
  });
});
