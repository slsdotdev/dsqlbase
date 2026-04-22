import { SQLStatement } from "@dsqlbase/core";
import { Session } from "@dsqlbase/core/runtime";
import { ExecutionContext, QueryBuilder, Schema, SchemaRegistry } from "@dsqlbase/core";
import { PGlite } from "@electric-sql/pglite";

import * as schema from "./schema.js";

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

  const session = new MockSession(pg);
  const registry = new SchemaRegistry(schema);

  const context = new ExecutionContext({
    session,
    dialect: new QueryBuilder(),
    schema: registry,
  });

  return {
    pg,
    context,
    session,
    schema,
    tables: registry.getTables(),
    close: async () => {
      await pg.close();
    },
  };
};

export type TestClient = Awaited<ReturnType<typeof createClient>>;
