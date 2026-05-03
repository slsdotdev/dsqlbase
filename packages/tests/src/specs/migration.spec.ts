import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, TestClient } from "../db/index.js";
import { sql } from "@dsqlbase/core";

describe("schema migrations", () => {
  let client: TestClient;

  beforeAll(async () => {
    client = createTestClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it("runs ddl statements without error", async () => {
    const query = sql`CREATE TABLE test_migration (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL
      )`.toQuery();

    const result = await client.pg.query(query.text, query.params);
    expect(result).toBeDefined();
  });
});
