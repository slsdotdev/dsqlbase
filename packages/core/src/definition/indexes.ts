import { Unique } from "../utils/index.js";
import { DefinitionNode, Kind, NodeRef } from "./base.js";
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
  protected _include?: ColumnRefs<TTable["columns"]>[];
  protected _distinctNulls?: boolean;

  constructor(name: TName, config: IndexConfig<TTable>) {
    super(name);

    this._table = config.table;
    this._unique = config.unique ?? false;
    this._distinctNulls = true;
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

  public include(cb: (columns: TTable["columns"]) => ColumnRefs<TTable["columns"]>[]): this {
    this._include = cb(this._table.columns);
    return this;
  }

  /**
   * Set nulls distinct behavior for the index.
   * `NULLS [NOT] DISTINCT` specifies whether NULL values are treated as distinct for the purposes of index uniqueness.
   * @default
   */

  public distinctNulls(distinct = true): this {
    this._distinctNulls = distinct;
    return this;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      unique: this._unique,
      distinctNulls: this._distinctNulls,
      columns: this._columns.map((col) => col.toJSON()),
      include: this._include ? this._include.map((col) => new NodeRef(col).toJSON()) : null,
    } as const;
  }
}

export class IndexColumnDefinition<
  TIdxName extends string,
  TColumn extends AnyColumnDefinition,
> extends DefinitionNode<`${TIdxName}_column_${TColumn["name"]}`> {
  public readonly kind = Kind.INDEX_COLUMN;

  protected _column: NodeRef<TColumn>;
  protected _sortDirection: "ASC" | "DESC" = "ASC";
  protected _nulls: "FIRST" | "LAST" = "LAST";

  constructor(index: TIdxName, column: TColumn) {
    super(`${index}_column_${column.name}`);

    this._column = new NodeRef(column);
  }

  sort(direction: "ASC" | "DESC" = "ASC"): this {
    this._sortDirection = direction;
    return this;
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
      sortDirection: this._sortDirection,
      nulls: this._nulls,
      column: this._column.toJSON(),
    } as const;
  }
}
