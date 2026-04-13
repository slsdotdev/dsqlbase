export * as schema from "./schema.js";

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "migrations/schema_create.sql");

export async function applyMigrations(pg: PGlite): Promise<void> {
  const sql = readFileSync(SCHEMA_PATH, "utf-8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pg.exec(statement);
  }
}
