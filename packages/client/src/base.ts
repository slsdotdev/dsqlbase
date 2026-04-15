import { DefinitionSchema, ExecutionContext } from "@dsqlbase/core";
import { SQLStatement, SQLQuery } from "@dsqlbase/core/sql";

export abstract class QueryClient<T extends DefinitionSchema> {
  private readonly _ctx: ExecutionContext<T>;

  constructor(ctx: ExecutionContext<T>) {
    this._ctx = ctx;
  }

  async $execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    return this._ctx.session.execute<T>(query);
  }

  async $raw<T = unknown>(sql: SQLQuery): Promise<T[]> {
    return this.$execute(sql.toQuery());
  }
}
