import { Session, SQLStatement } from "@dsqlbase/core";
import { vi } from "vitest";

export class MockSession implements Session {
  mock = vi.fn();

  public async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    this.mock(query);
    return {} as T[];
  }
}
