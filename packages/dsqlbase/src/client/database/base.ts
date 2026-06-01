import {
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  SQLQuery,
  SQLStatement,
} from "@dsqlbase/core";

export abstract class BaseClient<T extends DefinitionSchema> {
  protected readonly _ctx: ExecutionContext<T>;

  constructor(ctx: ExecutionContext<T>) {
    this._ctx = ctx;
  }

  $query<T = unknown>(sql: SQLQuery) {
    return new ExecutableQuery<T[]>(
      {
        mode: "many",
        name: "anonymous_query",
        type: "select",
        args: {},
        query: sql.toQuery(),
        resolve: (result) => result,
      },
      this._ctx.session
    );
  }

  async $execute<T = unknown>(query: SQLStatement): Promise<T[]> {
    return this._ctx.session.execute<T>(query);
  }
}
