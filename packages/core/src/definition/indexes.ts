import { Unique } from "../utils/index.js";
import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { ColumnGroupDefinition, GroupOf, TableColumnDefinitions } from "./embedded.js";
import { AnyTableDefinition, ColumnRefOf, ColumnRefs } from "./table.js";

export type IndexConfig = {
  unique?: boolean;
  table: AnyTableDefinition;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyIndexDefinition = IndexDefinition<any, any>;

/** Index columns for `columns` — a group nests its members' — as `index().columns()` gets them. */
export type IndexColumnRefs<
  TIndexName extends string,
  TColumns extends TableColumnDefinitions,
> = Readonly<{
  readonly [K in keyof TColumns]: TColumns[K] extends GroupOf<infer TGroupColumns>
    ? IndexColumnRefs<TIndexName, TGroupColumns>
    : IndexColumnDefinition<TIndexName, TColumns[K]>;
}>;

type IndexColumnOf<TIndexName extends string, TColumns extends TableColumnDefinitions> = {
  [K in keyof TColumns]: TColumns[K] extends GroupOf<infer TGroupColumns>
    ? IndexColumnOf<TIndexName, TGroupColumns>
    : IndexColumnDefinition<TIndexName, TColumns[K]>;
}[keyof TColumns];

export type ColumnConfigRefs<
  TIndexName extends string,
  TTable extends AnyTableDefinition,
> = IndexColumnRefs<TIndexName, TTable["columns"]>;

export type ColumnConfigType<
  TIndexName extends string,
  TTable extends AnyTableDefinition,
> = IndexColumnOf<TIndexName, TTable["columns"]>;

export class IndexDefinition<
  TName extends string,
  TTable extends AnyTableDefinition,
> extends DefinitionNode<TName, IndexConfig> {
  public readonly kind = Kind.INDEX;

  protected _table: TTable;
  protected _unique: boolean;
  protected _columns: ColumnConfigType<TName, TTable>[] = [];
  protected _include?: ColumnRefOf<TTable["columns"]>[];
  protected _distinctNulls?: boolean;

  constructor(name: TName, config: IndexConfig) {
    super(name);

    this._table = config.table as TTable;
    this._unique = config.unique ?? false;
    this._distinctNulls = true;
  }

  private _getColumnConfigRefs(
    columns: TableColumnDefinitions = this._table.columns
  ): ColumnConfigRefs<TName, TTable> {
    return Object.fromEntries(
      Object.entries(columns).map(([field, column]) => [
        field,
        column instanceof ColumnGroupDefinition
          ? this._getColumnConfigRefs(column.columns)
          : new IndexColumnDefinition(this.name, column),
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

  public include(
    cb: (columns: ColumnRefs<TTable["columns"]>) => ColumnRefOf<TTable["columns"]>[]
  ): this {
    this._include = cb(this._table._getColumnRefs());
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
      include: this._include ? this._include.map((col) => col.toJSON()) : null,
    } as const;
  }
}

export class IndexColumnDefinition<
  TIdxName extends string,
  // A column; typed as any definition so a ref need not be checked against the column class.
  TColumn extends DefinitionNode,
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
