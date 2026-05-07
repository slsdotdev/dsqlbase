import { Session, SQLStatement } from "@dsqlbase/core";
import { Pool } from "pg";

export class PGSession implements Session {
  private _client: Pool;

  constructor(client: Pool) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }
}

export function createPgSession(client: Pool): PGSession {
  return new PGSession(client);
}
