import { printSchemaForCreate, getSerializedSchemaObjects } from "@dsqlbase/schema/migration";
import { schema } from "../db/schema";
import { TestClient } from "../db/client";

async function applyMigrations(client: TestClient): Promise<void> {
  const definitions = getSerializedSchemaObjects(Object.values(schema));
  const statements = printSchemaForCreate(definitions);

  for (const statement of statements) {
    await client.$execute({ text: statement, params: [] });
  }
}

export { applyMigrations, schema };
