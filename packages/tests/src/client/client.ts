import { SQLStatement } from "@dsqlbase/core";
import { Session } from "@dsqlbase/core/runtime";
import { ExecutionContext, QueryDialect, Schema, SchemaRegistry } from "@dsqlbase/core/runtime";
import { PGlite } from "@electric-sql/pglite";

import { schema, applyMigrations } from "../schema/index.js";

const TABLE_NAMES = ["tasks", "team_members", "projects", "users", "teams"] as const;

class MockSession implements Session {
  private _client: PGlite;

  constructor(pg: PGlite) {
    this._client = pg;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }
}

export type ClientSchema = Schema<typeof schema>;

export const createClient = async () => {
  const pg = new PGlite("memory://", { debug: 0 });
  await applyMigrations(pg);

  const session = new MockSession(pg);
  const registry = new SchemaRegistry(schema);

  const context = new ExecutionContext({
    session,
    dialect: new QueryDialect(),
    schema: registry,
  });

  return {
    pg,
    context,
    session,
    tables: registry.getTables(),
    reset: async () => {
      return await pg.exec(TABLE_NAMES.map((t) => `TRUNCATE TABLE "${t}" CASCADE`).join("; "));
    },
    close: async () => {
      await pg.close();
    },
  };
};

export type TestClient = Awaited<ReturnType<typeof createClient>>;
