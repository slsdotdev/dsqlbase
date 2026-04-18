import { SQLIdentifier, SQLNode, SQLQuery } from "../sql/nodes.js";
import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyIndexDefinition, IndexConfig, IndexDefinition } from "./indexes.js";
import { SchemaDefinition } from "./schema.js";

export interface TableConfig<
  TSchema extends SchemaDefinition = SchemaDefinition,
  TColumns extends Record<string, AnyColumnDefinition> = Record<string, AnyColumnDefinition>,
> {
  schema?: TSchema;
  columns: TColumns;
}

export type AnyTableDefinition = TableDefinition<string, TableConfig>;

export type ColumnRefs<TTable extends AnyTableDefinition> = Readonly<{
  readonly [K in keyof TTable["columns"]]: SQLIdentifier;
}>;

export class TableDefinition<
  TName extends string,
  TConfig extends TableConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.TABLE;

  protected _schema?: SchemaDefinition;
  protected _indexes: AnyIndexDefinition[] = [];
  protected _checks?: SQLNode[];
  protected _unique?: SQLIdentifier[][];

  readonly columns: TConfig["columns"];

  constructor(name: TName, config: TConfig) {
    super(name);

    this._schema = config.schema;
    this.columns = config.columns as Readonly<TConfig["columns"]>;
  }

  /** @internal */
  _getColumnRefs(): ColumnRefs<this> {
    return Object.fromEntries(
      Object.entries(this.columns).map(([field, column]) => [field, new SQLIdentifier(column.name)])
    ) as ColumnRefs<this>;
  }

  public index<TIdxName extends string, TIdxConfig extends IndexConfig<this>>(
    name: TIdxName,
    config: Partial<Omit<TIdxConfig, "table">> = {}
  ): IndexDefinition<TIdxName, this> {
    const idx = new IndexDefinition(name, { ...config, table: this });
    this._indexes.push(idx);

    return idx as IndexDefinition<TIdxName, this>;
  }

  public check(cb: (columns: ColumnRefs<this>) => SQLNode): this {
    this._checks = this._checks ?? [];
    this._checks.push(cb(this._getColumnRefs()));

    return this;
  }

  public unique(cb: (columns: ColumnRefs<this>) => SQLIdentifier[]): this {
    this._unique = this._unique ?? [];
    this._unique.push(cb(this._getColumnRefs()));

    return this;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      schema: this._schema?.toJSON(),
      columns: Object.values(this.columns).map((col) => col.toJSON()),
      indexes: this._indexes.map((idx) => idx.toJSON()),
      checks: this._checks ? this._checks.map((chk) => new SQLQuery(chk).toJSON()) : undefined,
      unique: this._unique
        ? this._unique.map((cols) => cols.map((col) => new SQLQuery(col).toJSON()))
        : undefined,
    } as const;
  }
}
