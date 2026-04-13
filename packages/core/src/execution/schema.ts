import { DefinitionNode } from "../definition/base.js";
import { RelationsConfig, RelationsDefinition } from "../definition/relations.js";
import { TableDefinition } from "../definition/table.js";
import { TypedObject } from "../types/object.js";
import { AnyTable, Table } from "./table.js";
import { Schema } from "./types.js";

export type TableNameOf<TSchema extends Record<string, DefinitionNode>> = {
  [K in keyof TSchema]: TSchema[K] extends AnyTable ? K : never;
}[keyof TSchema];

export type RelationDefinitionsOf<
  TSchema extends Record<string, DefinitionNode>,
  TTableName extends string,
> =
  TSchema extends Record<string, infer Def>
    ? Def extends RelationsDefinition<TTableName, infer R>
      ? R extends RelationsConfig
        ? R["relations"]
        : never
      : never
    : never;

type NeverKeys<T> = { [K in keyof T]: T[K] extends never ? K : never }[keyof T];

type OmitNevers<T> = Omit<T, NeverKeys<T>>;

export class SchemaRegistry<
  TSchema extends Record<string, DefinitionNode> = Record<string, DefinitionNode>,
> implements TypedObject<Schema<TSchema>> {
  declare readonly __type: Schema<TSchema>;

  private _tables = new Map<string, AnyTable>();
  private _relations = new Map<string, AnyTable>();

  constructor(schema: TSchema) {
    this._buildTables(schema);
    // this._buildRelations(schema);
  }

  private _buildTables(schema: TSchema) {
    for (const [key, def] of Object.entries(schema)) {
      if (def instanceof TableDefinition) {
        const table = new Table(def);
        this._tables.set(def.name, table);
        this._tables.set(key, table);
      }
    }
  }

  public hasTable(aliasOrName: string): boolean {
    return this._tables.has(aliasOrName);
  }

  public getTables(): OmitNevers<{
    [K in keyof TSchema]: TSchema[K] extends TableDefinition<infer Name, infer Config>
      ? Table<Name, Config, RelationDefinitionsOf<TSchema, Name>>
      : never;
  }> {
    return Object.fromEntries(this._tables.entries()) as {
      [K in keyof TSchema]: TSchema[K] extends TableDefinition<infer Name, infer Config>
        ? Table<Name, Config, RelationDefinitionsOf<TSchema, Name>>
        : never;
    };
  }
}
