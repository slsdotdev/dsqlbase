import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { IndexConfig, IndexDefinition } from "./indexes.js";
import { SchemaDefinition } from "./schema.js";

export interface TableConfig<
  TSchema extends SchemaDefinition = SchemaDefinition,
  TColumns extends Record<string, AnyColumnDefinition> = Record<string, AnyColumnDefinition>,
> {
  schema?: TSchema;
  columns: TColumns;
}

export type AnyTableDefinition = TableDefinition<string, TableConfig>;

export class TableDefinition<
  TName extends string,
  TConfig extends TableConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.TABLE;

  protected _schema?: SchemaDefinition;
  protected _indexes: IndexDefinition<string, IndexConfig>[] = [];

  readonly columns: TConfig["columns"];

  constructor(name: TName, config: TConfig) {
    super(name);

    this._schema = config.schema;
    this.columns = config.columns as Readonly<TConfig["columns"]>;
  }

  public index<TIdxName extends string, TIdxConfig extends IndexConfig>(
    name: TIdxName,
    config?: Partial<Omit<TIdxConfig, "table">>
  ): IndexDefinition<TIdxName, IndexConfig> {
    const idx = new IndexDefinition(name, { ...config, table: this });
    this._indexes.push(idx);

    return idx;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      schema: this._schema?.toJSON(),
      columns: Object.fromEntries(
        Object.entries(this.columns).map(([name, column]) => [name, column.toJSON()])
      ),
      indexes: this._indexes.map((idx) => idx.toJSON()),
    } as const;
  }
}
