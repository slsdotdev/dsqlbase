import {
  AnyTable,
  AnyUnion,
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  RuntimeTables,
  RuntimeUnions,
  Schema,
  SQLQuery,
  SQLStatement,
} from "@dsqlbase/core";
import { ModelClient } from "./model.js";
import { UnionClient } from "./union.js";

export abstract class BaseClient<T extends DefinitionSchema> {
  protected readonly _ctx: ExecutionContext<T>;

  protected readonly _models = new Map<
    string,
    ModelClient<AnyTable, T> | UnionClient<AnyUnion, T>
  >();

  constructor(ctx: ExecutionContext<T>) {
    this._ctx = ctx;

    for (const [alias, table] of ctx.schema.getTableEntries()) {
      const model = new ModelClient<AnyTable, T>(ctx, table);
      this._models.set(alias, model);
    }

    for (const [alias, union] of ctx.schema.getUnions()) {
      const client = new UnionClient<AnyUnion, T>(ctx, union);
      this._models.set(alias, client);
    }
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
    // A `sql` template here is an object with no `text`: the session would run nothing.
    if (typeof (query as Partial<SQLStatement> | null)?.text !== "string") {
      throw new TypeError(
        "$execute takes a rendered statement ({ text, params }); pass a sql`…` template to " +
          "$query, or call .toQuery() on it."
      );
    }

    return this._ctx.session.execute<T>(query);
  }
}

export type Aliases<T extends DefinitionSchema> =
  | keyof RuntimeTables<Schema<T>>
  | keyof RuntimeUnions<Schema<T>>;

export type Models<T extends DefinitionSchema> = {
  readonly [K in Aliases<T>]: RuntimeTables<Schema<T>> extends Record<K, infer TTable>
    ? TTable extends AnyTable
      ? ModelClient<TTable, T>
      : never
    : RuntimeUnions<Schema<T>> extends Record<K, infer TUnion>
      ? TUnion extends AnyUnion
        ? UnionClient<TUnion, T>
        : never
      : never;
};

export type WithModels<
  TSchema extends DefinitionSchema,
  TClient extends BaseClient<TSchema>,
> = TClient & Models<TSchema>;

export function withModels<TSchema extends DefinitionSchema, TClient extends BaseClient<TSchema>>(
  client: TClient
): WithModels<TSchema, TClient> {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (target["_models"].has(prop as string)) {
        return target["_models"].get(prop as string);
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as WithModels<TSchema, TClient>;
}
