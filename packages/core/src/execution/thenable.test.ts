import { describe, expect, it, vi } from "vitest";
import { Thenable } from "./thenable.js";

class TestThenable<T = unknown> extends Thenable<T> {
  execute = vi.fn();
}

describe("Thenable", () => {
  it("should not execute when not awaited", () => {
    const thenable = new TestThenable();

    expect(thenable.execute).not.toHaveBeenCalled();
  });

  it("should execute when awaited", async () => {
    const thenable = new TestThenable();
    thenable.execute.mockResolvedValue("test");

    const result = await thenable;

    expect(thenable.execute).toHaveBeenCalled();
    expect(result).toBe("test");
  });

  it("should execute when .then is called", async () => {
    const thenable = new TestThenable();
    thenable.execute.mockResolvedValue("test");

    const result = await thenable.then();
    expect(thenable.execute).toHaveBeenCalled();
    expect(result).toBe("test");
  });

  it("should execute when .catch is called", async () => {
    const thenable = new TestThenable();
    const error = new Error("test error");
    thenable.execute.mockRejectedValue(error);

    await expect(thenable.catch()).rejects.toBe(error);
    expect(thenable.execute).toHaveBeenCalled();
  });

  it("should execute when .finally is called", async () => {
    const thenable = new TestThenable();
    thenable.execute.mockResolvedValue("test");

    await thenable.finally();
    expect(thenable.execute).toHaveBeenCalled();
  });

  it("should execute only once when multiple handlers are attached", async () => {
    const thenable = new TestThenable();
    thenable.execute.mockResolvedValue("test");

    await thenable.then().catch().finally();

    expect(thenable.execute).toHaveBeenCalledTimes(1);
  });
});
