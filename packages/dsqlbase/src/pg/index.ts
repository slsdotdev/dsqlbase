import { Session, SQLStatement } from "@dsqlbase/core";
import { ClientBase } from "pg";

export class PGSession implements Session {
  private _client: ClientBase;

  constructor(client: ClientBase) {
    this._client = client;
  }

  async execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    const result = await this._client.query(query.text, query.params);
    return result.rows as T[];
  }
}

export function createPgSession(client: ClientBase): PGSession {
  return new PGSession(client);
}
