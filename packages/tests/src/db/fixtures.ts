import { afterAll, beforeAll, beforeEach } from "vitest";
import { TableDefinition, type AnyTableDefinition } from "@dsqlbase/core";
import { createTestClient, type TestClient } from "./client.js";
import { applyMigrations } from "./migrate.js";
import { seedData, type SeededData } from "./seed.js";
import * as schema from "./schema.js";

export async function truncateAll(client: TestClient): Promise<void> {
  const tables = Object.values(schema)
    .filter((value): value is AnyTableDefinition => value instanceof TableDefinition)
    .map((table) => `"${table.name}"`);

  if (tables.length === 0) return;

  await client.$execute({
    text: `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY`,
    params: [],
  });
}

export interface SeededFixture {
  getClient: () => TestClient;
  getData: () => SeededData;
}

export function withSeededClient(): SeededFixture {
  let client: TestClient;
  let data: SeededData;

  beforeAll(async () => {
    client = createTestClient();
    await applyMigrations(client);
  });

  beforeEach(async () => {
    await truncateAll(client);
    data = await seedData(client);
  });

  afterAll(async () => {
    await client.close();
  });

  return {
    getClient: () => client,
    getData: () => data,
  };
}
