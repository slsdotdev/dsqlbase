import { describe, expect, it } from "vitest";
import { getSerializedSchemaObjects, printSchemaForCreate } from "@dsqlbase/schema/migration";
import { schema } from "../schema/index.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;
const serializedSchema = getSerializedSchemaObjects(Object.values(schema));

describe("Schema Migration", () => {
  it("should generate DDL statements for creating a schema", async () => {
    const ddlSQL = printSchemaForCreate(serializedSchema, {
      ifNotExists: true,
      breakStatements: true,
    });

    await writeFile(path.resolve(__dirname, "../schema/migrations/schema_generated.sql"), ddlSQL);
    expect(ddlSQL).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
