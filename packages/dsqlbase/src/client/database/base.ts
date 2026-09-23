import {
  AnyTable,
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  SQLQuery,
  SQLStatement,
  TenancyError,
} from "@dsqlbase/core";
import { ModelClient } from "../model/client.js";

export abstract class BaseClient<T extends DefinitionSchema> {
  protected readonly _ctx: ExecutionContext<T>;

  /** One model per table, keyed by schema alias. Populated by {@link attachModels}. */
  protected readonly _models = new Map<string, ModelClient<AnyTable, T>>();

  constructor(ctx: ExecutionContext<T>) {
    this._ctx = ctx;
  }

  /**
   * Raw SQL bypasses every seam the operations factory applies, the tenant predicate included,
   * so a scoped client does not carry it. The types remove it; this is the runtime half, for
   * callers reaching it through a widened type.
   */
  private _assertUnscoped(method: string): void {
    if (this._ctx.identity) {
      throw new TenancyError(
        `${method} is not available on an identity-scoped client: raw SQL is not tenant-safe. ` +
          `Use it on the base client, where that is plain to read.`
      );
    }
  }

  $query<T = unknown>(sql: SQLQuery) {
    this._assertUnscoped("$query");

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
    this._assertUnscoped("$execute");

    return this._ctx.session.execute<T>(query);
  }
}

/**
 * Attaches one {@link ModelClient} per table to a client, keyed by the table's schema
 * alias, as a non-writable enumerable property. Shared by `createClient` and the
 * transaction client so a derived client is built exactly one way.
 *
 * Tables are taken from `SchemaRegistry.getTableEntries()`, which yields each table once
 * under its alias — `getTables()` holds every table under both its alias and its database
 * name, which would attach two models for an aliased table.
 */
export function attachModels<T extends DefinitionSchema>(
  client: BaseClient<T>,
  ctx: ExecutionContext<T>
): void {
  for (const [alias, table] of ctx.schema.getTableEntries()) {
    const model = new ModelClient<AnyTable, T>(ctx, table);

    client["_models"].set(alias, model);

    Object.defineProperty(client, alias, {
      value: model,
      writable: false,
      enumerable: true,
    });
  }
}
