import { SQLIdentifier, SQLQuery } from "../sql/nodes.js";
import { Unique } from "../utils/index.js";
import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyTableDefinition, ColumnRefs } from "./table.js";

export interface IndexConfig<TTable extends AnyTableDefinition = AnyTableDefinition> {
  unique?: boolean;
  table: TTable;
}

export type AnyIndexDefinition = IndexDefinition<string, AnyTableDefinition>;

export type ColumnConfigRefs<
  TIndexName extends string,
  TTable extends AnyTableDefinition,
> = Readonly<{
  readonly [K in keyof TTable["columns"]]: IndexColumnDefinition<TIndexName, TTable["columns"][K]>;
}>;

export type ColumnConfigType<
  TIndexName extends string,
  TTable extends AnyTableDefinition,
> = ColumnConfigRefs<TIndexName, TTable>[keyof TTable["columns"]];

export class IndexDefinition<
  TName extends string,
  TTable extends AnyTableDefinition,
> extends DefinitionNode<TName, IndexConfig<TTable>> {
  public readonly kind = Kind.INDEX;

  protected _table: TTable;
  protected _unique: boolean;
  protected _columns: ColumnConfigType<TName, TTable>[] = [];
  protected _include?: SQLIdentifier[];
  protected _nullsDistinct?: boolean;

  constructor(name: TName, config: IndexConfig<TTable>) {
    super(name);

    this._table = config.table;
    this._unique = config.unique ?? false;
  }

  private _getColumnConfigRefs(): ColumnConfigRefs<TName, TTable> {
    return Object.fromEntries(
      Object.entries(this._table.columns).map(([field, column]) => [
        field,
        new IndexColumnDefinition(this.name, column),
      ])
    ) as ColumnConfigRefs<TName, TTable>;
  }

  public unique(): Unique<this> {
    this._unique = true;
    return this as Unique<this>;
  }

  public columns(
    cb: (columns: ColumnConfigRefs<TName, TTable>) => ColumnConfigType<TName, TTable>[]
  ): this {
    this._columns = cb(this._getColumnConfigRefs());
    return this;
  }

  public include(cb: (columns: ColumnRefs<TTable>) => SQLIdentifier[]): this {
    this._include = cb(this._table._getColumnRefs());
    return this;
  }

  /**
   * Set nulls distinct behavior for the index.
   * `NULLS [NOT] DISTINCT` specifies whether NULL values are treated as distinct for the purposes of index uniqueness.
   */

  public nullsDistinct(distinct = true): this {
    this._nullsDistinct = distinct;
    return this;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      unique: this._unique,
      nullsDistinct: this._nullsDistinct,
      columns: this._columns.map((col) => col.toJSON()),
      include: this._include ? this._include.map((col) => new SQLQuery(col).toJSON()) : undefined,
    } as const;
  }
}

export class IndexColumnDefinition<
  TIdxName extends string,
  TColumn extends AnyColumnDefinition,
> extends DefinitionNode<`${TIdxName}_column_${TColumn["name"]}`> {
  public readonly kind = Kind.INDEX_COLUMN;

  protected _column: SQLIdentifier;
  protected _nulls?: "FIRST" | "LAST";

  constructor(index: TIdxName, column: TColumn) {
    super(`${index}_column_${column.name}`);

    this._column = new SQLIdentifier(column.name);
  }

  nullsFirst(): this {
    this._nulls = "FIRST";
    return this;
  }

  nullsLast(): this {
    this._nulls = "LAST";
    return this;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      column: new SQLQuery(this._column).toJSON(),
      nulls: this._nulls,
    } as const;
  }
}
