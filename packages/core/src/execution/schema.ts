import { DefinitionNode } from "../definition/base.js";
import { TableDefinition } from "../definition/table.js";
import { AnyTable, Table } from "./table.js";

export type TableNameOf<TSchema extends Record<string, DefinitionNode>> = {
  [K in keyof TSchema]: TSchema[K] extends AnyTable ? K : never;
}[keyof TSchema];

export class SchemaRegistry<
  TSchema extends Record<string, DefinitionNode> = Record<string, DefinitionNode>,
> {
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

  public getTables(): {
    [K in keyof TSchema]: TSchema[K] extends TableDefinition<infer Name, infer Config>
      ? Table<Name, Config>
      : never;
  } {
    return Object.fromEntries(this._tables.entries()) as {
      [K in keyof TSchema]: TSchema[K] extends TableDefinition<infer Name, infer Config>
        ? Table<Name, Config>
        : never;
    };
  }
}
