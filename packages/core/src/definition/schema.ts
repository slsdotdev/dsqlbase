import { WithSchema } from "../index.js";
import { DefinitionNode, Kind } from "./base.js";
import { TableConfig, TableDefinition } from "./table.js";

export class SchemaDefinition<TName extends string = string> extends DefinitionNode<TName> {
  public readonly kind = Kind.SCHEMA;

  public table<TName extends string, TConfig extends TableConfig>(
    name: TName,
    config: TConfig
  ): WithSchema<TableDefinition<TName, TConfig>, this> {
    return new TableDefinition(name, { ...config, schema: this });
  }
}
