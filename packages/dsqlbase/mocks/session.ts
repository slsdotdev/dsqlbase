import { Session, SQLStatement } from "@dsqlbase/core";
import { Mock, vi } from "vitest";

export class MockSession implements Session {
  mock: Mock<(query: SQLStatement) => unknown> = vi.fn();

  public async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    return this.mock(query) as T[];
  }
}
