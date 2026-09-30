import {
  AnySchema,
  AnyTable,
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  Schema,
  SQLQuery,
  SQLStatement,
  TenancyError,
} from "@dsqlbase/core";
import { AnyUnionMembers } from "@dsqlbase/core/definition";
import { ModelClient } from "../model/client.js";
import { UnionClient } from "../union/client.js";
import {
  GlobalIdListResultOf,
  GlobalIdOptionsOf,
  GlobalIdResultOf,
  JoinExpressionOf,
  WhereExpressionOf,
} from "../model/base.js";
import { GlobalIdError, decodeGlobalId } from "../../schema/utils/global-id.js";
import { NodeTable, getNodes } from "../nodes.js";

/** The member arguments an `on` entry carries into a global-id lookup. */
type NodeArgs = {
  select?: Record<string, boolean>;
  where?: WhereExpressionOf<AnyTable>;
  join?: JoinExpressionOf<AnyTable, AnySchema>;
};

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

  /**
   * Resolves a global id to the node it names, and to how the caller wants it read.
   *
   * Every failure is raised here, before a query is built: an id that does not decode, one
   * naming a table that is not a node, one whose payload is not that node's key, and one the
   * caller's `on` map excluded.
   */
  private _resolveNode(
    id: string,
    on?: Record<string, unknown>
  ): { node: NodeTable; value: string; args: NodeArgs } {
    const { key, pk } = decodeGlobalId(id);
    const node = getNodes(this._ctx.schema).get(key);

    if (!node) {
      throw new GlobalIdError("unknown_node", `"${key}" is not a node in this schema.`);
    }

    const fields = Object.keys(pk);

    if (fields.length !== 1 || fields[0] !== node.keyField) {
      throw new GlobalIdError(
        "key_mismatch",
        `Global id for "${key}" carries ${fields.map((field) => `"${field}"`).join(", ")} ` +
          `rather than its key "${node.keyField}".`
      );
    }

    const option = on?.[node.alias];

    if (option === false) {
      throw new GlobalIdError(
        "unknown_node",
        `"${node.alias}" was excluded from this lookup by its \`on\` map.`
      );
    }

    const { select, where, join } = (option && typeof option === "object" ? option : {}) as NodeArgs;

    return { node, value: pk[node.keyField], args: { select, where, join } };
  }

  /**
   * A `where` over a field named at runtime.
   *
   * `_models` is keyed by alias and typed over `AnyTable`, so the key field is a `string` the
   * compiler cannot match to a column. The node registry resolved it against the real table
   * when the client was built, which is the check this cast stands on.
   */
  private _byKey(field: string, condition: object): WhereExpressionOf<AnyTable> {
    return { [field]: condition } as WhereExpressionOf<AnyTable>;
  }

  /**
   * The lookup's own key filter, AND-ed with the member's `on.<alias>.where` when it has one. A
   * row that fails the member filter is a miss, exactly as if the id named nothing.
   */
  private _lookupWhere(
    field: string,
    condition: object,
    where: WhereExpressionOf<AnyTable> | undefined
  ): WhereExpressionOf<AnyTable> {
    const key = this._byKey(field, condition);

    return where ? ({ and: [key, where] } as WhereExpressionOf<AnyTable>) : key;
  }

  private _model(alias: string): ModelClient<AnyTable, T> {
    const model = this._models.get(alias);

    if (!model) {
      throw new Error(`No model is attached for "${alias}".`);
    }

    return model;
  }

  /**
   * Reads the single row a global id names, or `null` when it no longer exists.
   *
   * The lookup runs through the table's own model client rather than issuing SQL of its own,
   * so every seam a `findOne` passes applies to it — the tenant predicate above all. A node
   * lookup that bypassed it would be a cross-tenant read; going through the model makes that
   * structurally impossible rather than something to remember.
   *
   * The row is tagged with `$$key`, the alias it came from, which is what narrows the union.
   * `$$meta.key` carries the same value but cannot be used for it: TypeScript does not narrow
   * on a nested discriminant.
   *
   * @example
   * ```ts
   * const record = await dsql.$findByGlobalId({
   *   id,
   *   on: { users: { select: { id: true, name: true } }, workspaces: true },
   * });
   *
   * if (record?.$$key === "users") record.name;
   * ```
   *
   * @throws GlobalIdError when the id does not decode, names a table that is not a node,
   *   carries a payload that is not that node's key, or names a member `on` set to `false`.
   */
  async $findByGlobalId<TOn extends GlobalIdOptionsOf<Schema<T>> | undefined = undefined>(args: {
    id: string;
    on?: TOn;
  }): Promise<GlobalIdResultOf<Schema<T>, TOn>> {
    const { node, value, args: nodeArgs } = this._resolveNode(args.id, args.on);
    const { select, where, join } = nodeArgs;

    const row = (await this._model(node.alias).findOne({
      where: this._lookupWhere(node.keyField, { eq: value }, where),
      ...(select ? { select } : {}),
      ...(join ? { join } : {}),
    })) as Record<string, unknown> | null;

    return (row ? this._tag(row, node) : null) as GlobalIdResultOf<Schema<T>, TOn>;
  }

  /** Tags a resolved row with the alias it came from, so a caller can narrow the union. */
  private _tag(row: Record<string, unknown>, node: NodeTable): Record<string, unknown> {
    return { ...row, $$key: node.alias };
  }

  /**
   * Reads many global ids at once: one query per table rather than one per id, with the
   * results handed back **in the order the ids were given** and `null` wherever a row no
   * longer exists — the shape a batch resolver wants.
   *
   * Unlike {@link $findByGlobalId} this cannot be a single `ExecutableQuery`, because ids
   * from different tables fan out to different queries.
   *
   * The node's key field is always projected, even when `select` leaves it out: matching a
   * row back to the id that asked for it is what the key is for.
   *
   * @throws GlobalIdError on the first id that does not resolve. A missing *row* is a `null`
   *   in the result; a malformed id is a caller bug and is not silently dropped.
   */
  async $listByGlobalId<TOn extends GlobalIdOptionsOf<Schema<T>> | undefined = undefined>(args: {
    ids: readonly string[];
    on?: TOn;
  }): Promise<(GlobalIdListResultOf<Schema<T>, TOn> | null)[]> {
    const resolved = args.ids.map((id) => this._resolveNode(id, args.on));
    const groups = new Map<string, { node: NodeTable; values: Set<string>; args: NodeArgs }>();

    for (const { node, value, args: nodeArgs } of resolved) {
      const group = groups.get(node.alias) ?? { node, values: new Set<string>(), args: nodeArgs };

      group.values.add(value);
      groups.set(node.alias, group);
    }

    // One query per table, all of them in flight together.
    const rows = new Map<string, Record<string, unknown>>();

    await Promise.all(
      [...groups.values()].map(async ({ node, values, args: { select, where, join } }) => {
        const found = (await this._model(node.alias).findMany({
          where: this._lookupWhere(node.keyField, { in: [...values] }, where),
          // The key is always projected: it is the only thing that can put a row back
          // against the id that asked for it.
          ...(select ? { select: { ...select, [node.keyField]: true } } : {}),
          ...(join ? { join } : {}),
        })) as unknown as Record<string, unknown>[];

        for (const row of found) {
          // The key column reads back already wrapped, so the row indexes by global id.
          rows.set(String(row[node.keyField]), this._tag(row, node));
        }
      })
    );

    return args.ids.map(
      (id) => (rows.get(id) ?? null) as GlobalIdListResultOf<Schema<T>, TOn> | null
    );
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

  // Unions are read under their own alias, next to the tables; the registry already refused a
  // union named like a table, so the two cannot collide.
  for (const [alias, union] of ctx.schema.getUnions()) {
    Object.defineProperty(client, alias, {
      value: new UnionClient<AnyUnionMembers, T>(ctx, union),
      writable: false,
      enumerable: true,
    });
  }
}
