import { DefinitionSchema, ExecutionContext, SQLQuery, SQLStatement } from "@dsqlbase/core";

export abstract class BaseClient<T extends DefinitionSchema> {
  private readonly _ctx: ExecutionContext<T>;

  constructor(ctx: ExecutionContext<T>) {
    this._ctx = ctx;
  }

  async $query<T = unknown>(sql: SQLQuery): Promise<T[]> {
    return this.$execute(sql.toQuery());
  }

  async $execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    return this._ctx.session.execute<T>(query);
  }
}
