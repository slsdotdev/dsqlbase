import { Session, SQLStatement } from "@dsqlbase/core";
import { PGlite } from "@electric-sql/pglite";

export class PgLiteSession implements Session {
  private _client: PGlite;

  constructor(client: PGlite) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }

  async beginTransaction() {
    this._client.exec("BEGIN");

    return {
      execute: async <T = unknown>(query: SQLStatement): Promise<T[]> => {
        const result = await this._client.query(query.text, query.params);
        return result.rows as T[];
      },
      commit: async () => {
        await this._client.exec("COMMIT");
      },
      rollback: async () => {
        await this._client.exec("ROLLBACK");
      },
    };
  }
}

export function createPgLiteSession(client: PGlite): PgLiteSession {
  return new PgLiteSession(client);
}
