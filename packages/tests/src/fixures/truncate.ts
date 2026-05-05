import { TestClient } from "../db";
import { schema } from "../db/schema";

export async function truncateTables(client: TestClient, tables: string[] = []) {
  const tableNames = tables.length
    ? tables.map((table) => `"${table}"`)
    : Object.values(schema)
        .filter((d) => d.kind === "TABLE")
        .map((table) => `"${table.name}"`);

  if (tableNames.length === 0) {
    return;
  }

  return client.$execute({
    text: `TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY`,
    params: [],
  });
}
