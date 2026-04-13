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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTableDefinition = TableDefinition<any, any>;

export class TableDefinition<
  TName extends string,
  out TConfig extends TableConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.TABLE;

  protected _schema?: SchemaDefinition;
  protected _columns: TConfig["columns"];
  protected _indexes: IndexDefinition<string, IndexConfig, this>[] = [];

  constructor(name: TName, config: TConfig) {
    super(name);

    this._schema = config.schema;
    this._columns = config.columns ?? {};
  }

  public index<TIdxName extends string, TIdxConfig extends IndexConfig>(
    name: TIdxName,
    config?: Partial<TIdxConfig>
  ): IndexDefinition<TIdxName, IndexConfig, this> {
    const idx = new IndexDefinition(name, config, this);
    this._indexes.push(idx);

    return idx;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      schema: this._schema?.toJSON(),
      columns: Object.fromEntries(
        Object.entries(this._columns).map(([name, column]) => [name, column.toJSON()])
      ),
      indexes: this._indexes.map((idx) => idx.toJSON()),
    } as const;
  }
}
