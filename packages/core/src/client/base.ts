import { ExecutionContext } from "../execution/context.js";
import { SQLQuery, SQLStatement } from "../sql/nodes.js";

export abstract class QueryClient {
  private readonly _ctx: ExecutionContext;

  constructor(ctx: ExecutionContext) {
    this._ctx = ctx;
  }

  async $execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    return this._ctx.session.execute<T>(query);
  }

  async $raw<T = unknown>(sql: SQLQuery): Promise<T[]> {
    return this.$execute(sql.toQuery());
  }
}
