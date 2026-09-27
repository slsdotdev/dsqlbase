import { describe, expect, it, vi } from "vitest";
import { sql } from "../sql/index.js";
import { CompositeQuery, ExecutableQuery } from "./executor.js";
import { AnyOperation } from "./operation.js";
import { Session } from "./session.js";

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
