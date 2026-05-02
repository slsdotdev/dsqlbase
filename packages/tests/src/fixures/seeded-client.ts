import { afterAll, beforeAll, beforeEach } from "vitest";
import { createTestClient, TestClient } from "../db";
import { applyMigrations } from "./migrate";
import { seedData, SeededData } from "./seed";
import { truncateTables } from "./truncate";

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
    await truncateTables(client);
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
