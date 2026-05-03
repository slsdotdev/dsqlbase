import { Session, SQLStatement } from "@dsqlbase/core";
import { table } from "../definition/table.js";
import { uuid } from "../../dist/definition/columns/uuid.js";
import { text } from "../definition/index.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMigrationRunner, MigrationRunner } from "./runner.js";

export const mockConnector = vi.fn();

class TestSession implements Session {
  public readonly executed: SQLStatement[] = [];

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    this.executed.push(query);
    return mockConnector(query);
  }
}

const usersTable = table("users", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
});

describe("MigrationRunner", () => {
  let session: TestSession;
  let runner: MigrationRunner;

  beforeAll(() => {
    session = new TestSession();
    runner = createMigrationRunner(session);
  });

  it("should plan migration", async () => {
    mockConnector.mockResolvedValueOnce([{ definitions: [] }]);
    const planResult = await runner.plan([usersTable.toJSON()]);

    expect(planResult.operations).toHaveLength(1);
    expect(planResult.operations[0].type).toBe("CREATE");
    expect(planResult.operations[0].statement.__kind).toBe("CREATE_TABLE");
    expect(planResult.errors).toHaveLength(0);
    expect(planResult.destructive).toBe(false);
  });
});
