import { TypedObject, Prettify, WithMeta } from "../utils/index.js";
import { DefinitionSchema, TableDefinition, UnionDefinition } from "../definition/index.js";
import { validateSchema } from "../validation/index.js";
import { AnySchema, Schema, SchemaTableRelations } from "./base.js";
import { buildSchema } from "./build.js";
import { RuntimeRelation } from "./relation.js";
import { AnyTable, Table } from "./table.js";
import { AnyUnion, Union } from "./union.js";

/**
 * The metadata a definition declared with `table().meta()`. Rebuilding a `Table` from the
 * definition's three type parameters would otherwise drop it, taking `$$meta`'s declared
 * half with it.
 */
export type DeclaredTableMeta<TDef> = TDef extends { __type: { meta: infer M } } ? M : unknown;

export type RuntimeTables<TSchema extends AnySchema> = {
  [K in keyof TSchema["tables"]]: TSchema["tables"][K] extends TableDefinition<
    infer Name,
    infer Columns,
    infer Schema
  >
    ? WithMeta<
        Table<Name, Columns, Schema, SchemaTableRelations<TSchema, Name>>,
        DeclaredTableMeta<TSchema["tables"][K]>
      >
    : never;
};

export type RuntimeUnions<TSchema extends AnySchema> = {
  [K in keyof TSchema["unions"]]: TSchema["unions"][K] extends UnionDefinition<
    infer TMembers,
    infer TColumns
  >
    ? Union<TMembers, TColumns>
    : never;
};

export type TableByAlias<
  TSchema extends AnySchema,
  TAlias extends string,
> = TAlias extends keyof TSchema["tables"]
  ? TSchema["tables"][TAlias] extends TableDefinition<infer Name, infer Columns, infer Schema>
    ? WithMeta<
        Table<Name, Columns, Schema, SchemaTableRelations<TSchema, Name>>,
        DeclaredTableMeta<TSchema["tables"][TAlias]>
      >
    : never
  : never;

export type TableByName<TSchema extends AnySchema, TName extends string> =
  TSchema["tables"] extends Record<string, infer Def>
    ? Def extends TableDefinition<TName, infer Columns, infer Schema>
      ? Table<TName, Columns, Schema, SchemaTableRelations<TSchema, TName>>
      : never
    : never;

export type TableByNameOrAlias<
  TSchema extends AnySchema,
  TName extends string,
> = keyof TSchema["tables"] extends never
  ? AnyTable
  : TableByAlias<TSchema, TName> extends never
    ? TableByName<TSchema, TName>
    : TableByAlias<TSchema, TName>;

/**
 * The runtime form of a schema, for lookups.
 *
 * Built in two steps that know nothing of each other: `validateSchema` checks the definition and
 * keeps nothing, then `buildSchema` makes the runtime objects — tables, unions, relations
 * resolved to runtime columns, and the references they set. The registry only holds the result.
 */
export class SchemaRegistry<
  TDefinition extends DefinitionSchema = DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _tables: Map<string, AnyTable>;
  private readonly _unions: Map<string, AnyUnion>;
  private readonly _relations: Map<AnyTable, Readonly<Record<string, RuntimeRelation>>>;

  constructor(definition: TDefinition) {
    validateSchema(definition);

    const built = buildSchema(definition);

    this._tables = built.tables;
    this._unions = built.unions;
    this._relations = built.relations;
  }

  public getTable<TName extends string>(
    aliasOrName: TName
  ): TableByNameOrAlias<this["__type"], TName> {
    const table = this._tables.get(aliasOrName);

    if (!table) {
      throw new Error(`Table not found: ${aliasOrName}`);
    }

    return table as TableByNameOrAlias<this["__type"], TName>;
  }

  public hasTable(aliasOrName: string): boolean {
    return this._tables.has(aliasOrName);
  }

  public getTables(): Prettify<RuntimeTables<this["__type"]>> {
    return Object.fromEntries(this._tables.entries()) as RuntimeTables<this["__type"]>;
  }

  /**
   * One entry per table, keyed by schema alias. Unlike `getTables()`, which holds every
   * table under both its alias and its database name, this never yields the same table
   * twice — use it whenever you iterate tables to build something per table.
   */
  public getTableEntries(): [alias: string, table: AnyTable][] {
    const entries = new Map<string, AnyTable>();

    for (const table of this._tables.values()) {
      entries.set(table.alias, table);
    }

    return [...entries.entries()];
  }

  /**
   * The schema alias for a table, given either its alias or its database name.
   * Throws when no such table exists.
   */
  public getAlias(nameOrAlias: string): string {
    return this.getTable(nameOrAlias).alias;
  }

  /**
   * A table's relation by field, resolved: runtime columns on both sides, the runtime target,
   * and for a relation to a union its per-member columns and discriminator. `undefined` when
   * the table has no such relation. Takes the table, its alias or its database name.
   */
  public getRelation(table: AnyTable | string, field: string): RuntimeRelation | undefined {
    return this.getRelations(table)[field];
  }

  /** Every relation a table has, by field — empty for a table with none. */
  public getRelations(table: AnyTable | string): Readonly<Record<string, RuntimeRelation>> {
    const resolved = typeof table === "string" ? this.getTable(table) : table;

    return this._relations.get(resolved) ?? {};
  }

  public hasUnion(alias: string): boolean {
    return this._unions.has(alias);
  }

  public getUnion(alias: string): AnyUnion {
    const union = this._unions.get(alias);

    if (!union) {
      throw new Error(`Union not found: ${alias}`);
    }

    return union;
  }

  /** One entry per union, keyed by schema alias. */
  public getUnions(): [alias: string, union: AnyUnion][] {
    return [...this._unions.entries()];
  }
}
