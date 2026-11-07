import {
  AnyTable,
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  Schema,
  SQLQuery,
  SQLStatement,
} from "@dsqlbase/core";
import { AnyUnionDefinition } from "@dsqlbase/core/definition";
import { ModelClient } from "../model/client.js";
import { UnionClient } from "../union/client.js";
import { GlobalIdResultOf } from "../model/base.js";
import { WhereExpressionOf } from "../model/filters.js";
import { GlobalIdError, decodeGlobalId, isGlobalId } from "../../schema/utils/global-id.js";
import { NodeTable, getNodes } from "../nodes.js";

/** A global id resolved against the schema: its table, the unique key it matches, its values. */
type ResolvedId = {
  readonly node: NodeTable;
  readonly fields: readonly string[];
  readonly pk: Record<string, string>;
};

export abstract class BaseClient<T extends DefinitionSchema> {
  protected readonly _ctx: ExecutionContext<T>;

  /** One model per table, keyed by schema alias. Populated by {@link attachModels}. */
  protected readonly _models = new Map<string, ModelClient<AnyTable, T>>();

  constructor(ctx: ExecutionContext<T>) {
    this._ctx = ctx;
  }

  /**
   * Raw SQL bypasses every seam the operations factory applies, row policies included, so a
   * settings client does not carry it. The types remove it; this is the runtime half, for
   * callers reaching it through a widened type.
   */
  private _assertUnscoped(method: string): void {
    if (this._ctx.settings) {
      throw new Error(
        `${method} is not available on a client carrying settings: raw SQL bypasses every row ` +
          `policy. Use it on the base client, where that is plain to read.`
      );
    }
  }

  /**
   * Resolves a global id to the table it names and the unique key its payload matches.
   *
   * Every failure is raised here, before a query is built: an id that does not decode, one
   * naming a table that is not in the schema or has no unique key, and one whose fields are not
   * exactly one of that table's unique keys — a payload that could match many rows is not an
   * address.
   */
  private _resolveNode(id: string): ResolvedId {
    const { key, pk } = decodeGlobalId(id);
    const node = getNodes(this._ctx.schema).get(key);

    if (!node) {
      throw new GlobalIdError(
        "unknown_node",
        `"${key}" is not a table with a unique key in this schema.`
      );
    }

    const fields = Object.keys(pk).sort();
    const match = node.keys.find(
      (key) => key.length === fields.length && key.every((field, i) => field === fields[i])
    );

    if (!match) {
      const list = (key: readonly string[]) => `(${key.join(", ")})`;

      throw new GlobalIdError(
        "key_mismatch",
        `Global id for "${key}" carries ${list(fields)}, which is not a unique key of it. ` +
          `Its keys are ${node.keys.map(list).join(", ")}.`
      );
    }

    return { node, fields: match, pk };
  }

  /**
   * A `where` matching one payload on every field of its key.
   *
   * `_models` is keyed by alias and typed over `AnyTable`, so the key fields are `string`s the
   * compiler cannot match to columns. The node registry resolved them against the real table
   * when the client was built, which is the check this cast stands on.
   */
  private _byKey(
    fields: readonly string[],
    pk: Record<string, string>
  ): WhereExpressionOf<AnyTable> {
    return Object.fromEntries(
      fields.map((field) => [field, { eq: pk[field] }])
    ) as WhereExpressionOf<AnyTable>;
  }

  /**
   * One `where` for every payload of a group: an `in` over a single-field key, an `or` of
   * field maps over a composite one.
   */
  private _byKeys(
    fields: readonly string[],
    pks: Record<string, string>[]
  ): WhereExpressionOf<AnyTable> {
    if (fields.length === 1) {
      const [field] = fields as [string];

      return { [field]: { in: pks.map((pk) => pk[field]) } } as WhereExpressionOf<AnyTable>;
    }

    return { or: pks.map((pk) => this._byKey(fields, pk)) } as WhereExpressionOf<AnyTable>;
  }

  private _model(alias: string): ModelClient<AnyTable, T> {
    const model = this._models.get(alias);

    if (!model) {
      throw new Error(`No model is attached for "${alias}".`);
    }

    return model;
  }

  /**
   * Reads the single row a global id names, with every column, or `null` when it no longer
   * exists. A narrower read is that table's own `findOne`, keyed by the same id.
   *
   * The lookup runs through the table's own model client rather than issuing SQL of its own,
   * so every seam a `findOne` passes applies to it — row policies above all. A node
   * lookup that bypassed them would read rows a policy hides; going through the model makes that
   * structurally impossible rather than something to remember.
   *
   * The row is tagged with `$$key`, the alias it came from, which is what narrows the union.
   * `$$meta.key` carries the same value but cannot be used for it: TypeScript does not narrow
   * on a nested discriminant.
   *
   * @example
   * ```ts
   * const record = await dsql.$findByGlobalId(id);
   *
   * if (record?.$$key === "users") record.name;
   * ```
   *
   * @throws GlobalIdError when the id does not decode, names a table that is not in the schema,
   *   or carries fields that are not one of that table's unique keys.
   */
  async $findByGlobalId(id: string): Promise<GlobalIdResultOf<Schema<T>>> {
    const { node, fields, pk } = this._resolveNode(id);

    const row = await this._model(node.alias).findOne({
      where: this._byKey(fields, pk),
    });

    return (row ? this._tag(row, node) : null) as GlobalIdResultOf<Schema<T>>;
  }

  /** Tags a resolved row with the alias it came from, so a caller can narrow the union. */
  private _tag(row: Record<string, unknown>, node: NodeTable): Record<string, unknown> {
    return { ...row, $$key: node.alias };
  }

  /**
   * Reads many global ids at once, each row with every column: one query per table rather than
   * one per id, with the results handed back **in the order the ids were given** and `null`
   * wherever a row no longer exists — the shape a batch resolver wants.
   *
   * Unlike {@link $findByGlobalId} this cannot be a single `ExecutableQuery`, because ids
   * from different tables fan out to different queries.
   *
   * @example
   * ```ts
   * const [a, b, c] = await dsql.$listByGlobalId([id1, id2, id3]); // b is null if id2 is gone
   * ```
   *
   * @throws GlobalIdError on the first id that does not resolve. A missing *row* is a `null`
   *   in the result; a malformed id is a caller bug and is not silently dropped.
   */
  async $listByGlobalId(ids: readonly string[]): Promise<GlobalIdResultOf<Schema<T>>[]> {
    const resolved = ids.map((id) => this._resolveNode(id));
    const groups = new Map<
      string,
      { node: NodeTable; fields: readonly string[]; pks: Map<string, Record<string, string>> }
    >();

    // A table may be asked for under two different keys in one batch; each is its own query.
    for (const { node, fields, pk } of resolved) {
      const id = matchKey(node, fields, (field) => pk[field]);
      const group = groups.get(id.group) ?? { node, fields, pks: new Map() };

      group.pks.set(id.row, pk);
      groups.set(id.group, group);
    }

    // One query per table and key, all of them in flight together. Rows are matched back by
    // canonical key values, not by id text: the database finds a row for any spelling of its
    // uuid.
    const rows = new Map<string, Record<string, unknown>>();

    await Promise.all(
      [...groups.entries()].map(async ([group, { node, fields, pks }]) => {
        const found = await this._model(node.alias).findMany({
          where: this._byKeys(fields, [...pks.values()]),
        });

        for (const row of found) {
          const id = matchKey(node, fields, (field) => rawValue(row[field]));
          rows.set(`${group}\u0000${id.row}`, this._tag(row, node));
        }
      })
    );

    return resolved.map(({ node, fields, pk }) => {
      const id = matchKey(node, fields, (field) => pk[field]);

      return (rows.get(`${id.group}\u0000${id.row}`) ?? null) as GlobalIdResultOf<Schema<T>>;
    });
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
      value: new UnionClient<AnyUnionDefinition, T>(ctx, union),
      writable: false,
      enumerable: true,
    });
  }
}

/**
 * How `$listByGlobalId` puts a row back against the id that asked for it: the group is the
 * table and key, the row the key's values. uuid values are canonicalised, so any spelling of
 * one matches what the database hands back.
 */
function matchKey(
  node: NodeTable,
  fields: readonly string[],
  valueOf: (field: string) => string | undefined
): { group: string; row: string } {
  const values = fields.map((field) => {
    const value = valueOf(field) ?? "";

    return node.table.getColumn(field)?.dataType === "uuid" ? canonicalUuid(value) : value;
  });

  return { group: `${node.alias}\u0000${fields.join(",")}`, row: values.join("\u0000") };
}

/**
 * A key value as a payload carries it. A guid column reads back wrapped, and one bound to
 * another table wraps under that table's field (`articleTags.articleId` reads as
 * `["articles", { id }]`), so the stored value is the payload's only entry.
 */
function rawValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return isGlobalId(value) ? Object.values(decodeGlobalId(value).pk)[0] : String(value);
}

/**
 * A uuid as PostgreSQL prints it — lower case, hyphenated 8-4-4-4-12 — from any spelling its
 * input accepts (upper case, braces, hyphens anywhere or none). Anything that is not 32 hex
 * digits is returned as given: the database refuses it.
 */
function canonicalUuid(value: string): string {
  const hex = value.replace(/[{}-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return value;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
