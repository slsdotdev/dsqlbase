import { SQLIdentifier, SQLNode, SQLQuery } from "../sql/nodes.js";
import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyCheckConstraintDefinition, CheckConstraintDefinition } from "./constraint.js";
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

export type ColumnIndentifiers<TColumns extends Record<string, AnyColumnDefinition>> = Readonly<{
  readonly [K in keyof TColumns]: SQLIdentifier;
}>;

export type ColumnRefs<
  TColumns extends Record<string, AnyColumnDefinition> = Record<string, AnyColumnDefinition>,
> = {
  readonly [K in keyof TColumns]: TColumns[K];
}[keyof TColumns];

export class TableDefinition<
  TName extends string,
  TConfig extends TableConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.TABLE;

  protected _schema?: SchemaDefinition;
  protected _indexes: AnyIndexDefinition[] = [];
  protected _checks?: AnyCheckConstraintDefinition[];
  protected _unique?: ColumnRefs[][];

  readonly columns: TConfig["columns"];

  constructor(name: TName, config: TConfig) {
    super(name);

    this._schema = config.schema;
    this.columns = config.columns as Readonly<TConfig["columns"]>;
  }

  /** @internal */
  _getColumnIdefs(): ColumnIndentifiers<this["columns"]> {
    return Object.fromEntries(
      Object.entries(this.columns).map(([field, column]) => [field, new SQLIdentifier(column.name)])
    ) as ColumnIndentifiers<this["columns"]>;
  }

  public index<TIdxName extends string, TIdxConfig extends IndexConfig<this>>(
    name: TIdxName,
    config: Partial<Omit<TIdxConfig, "table">> = {}
  ): IndexDefinition<TIdxName, this> {
    const idx = new IndexDefinition(name, { ...config, table: this });
    this._indexes.push(idx);

    return idx as IndexDefinition<TIdxName, this>;
  }

  public check(cb: (columns: ColumnIndentifiers<this["columns"]>) => SQLNode, name?: string): this {
    this._checks = this._checks ?? [];
    const expression = new SQLQuery(cb(this._getColumnIdefs()));
    this._checks.push(new CheckConstraintDefinition(name ?? `${this.name}_check`, { expression }));

    return this;
  }

  public unique(cb: (columns: this["columns"]) => ColumnRefs[]): this {
    this._unique = this._unique ?? [];
    this._unique.push(cb(this.columns));

    return this;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      schema: this._schema?.toJSON(),
      columns: Object.values(this.columns).map((col) => col.toJSON()),
      indexes: this._indexes.map((idx) => idx.toJSON()),
      checks: this._checks ? this._checks.map((check) => check.toJSON()) : undefined,
      unique: this._unique
        ? this._unique.map((cols) => cols.map((col) => new NodeRef(col).toJSON()))
        : undefined,
    } as const;
  }
}
