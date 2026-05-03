import { createMigrationRunner, getSerializedSchemaObjects } from "@dsqlbase/schema/migration";
import { schema } from "./schema";
import { TestClient } from "./client";

export async function applyMigrations(client: TestClient): Promise<void> {
  const runner = createMigrationRunner(client.session);
  const definitions = getSerializedSchemaObjects(Object.values(schema));

  await runner.run(definitions, { asyncIndexes: false, destructive: true, safeOperations: true });
}
