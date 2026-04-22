import * as schema from "./schema.js";

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import {
  printSchemaForCreate,
  getSerializedSchemaObjects,
  STATEMENT_BREAKPOINT,
} from "@dsqlbase/schema/migration";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "migrations/schema_generated.sql");

async function applyMigrations(pg: PGlite): Promise<void> {
  const definitions = getSerializedSchemaObjects(Object.values(schema));
  const statements = printSchemaForCreate(definitions);

  await writeFile(
    SCHEMA_PATH,
    statements.join(`;\n${STATEMENT_BREAKPOINT}\n`).concat(";"),
    "utf-8"
  );

  for (const statement of statements) {
    await pg.exec(statement);
  }
}

export { applyMigrations, schema };
