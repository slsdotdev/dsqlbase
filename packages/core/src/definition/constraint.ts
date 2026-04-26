import { SQLQuery } from "../sql/nodes.js";
import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyTableDefinition, ColumnRefs } from "./table.js";

type ColumnRef = NodeRef<AnyColumnDefinition>;

export type JoinColumnNames<T extends ColumnRef[]> = T extends [
  infer I extends ColumnRef,
  ...infer R extends ColumnRef[],
]
  ? R extends []
    ? I["name"]
    : `${I["name"]}_${JoinColumnNames<R>}`
  : "";

export type InferConstraintName<
  TName extends string | undefined,
  TSource extends NodeRef<DefinitionNode>,
  TColumns extends ColumnRef[],
  TSuffix extends string,
> = TName extends string ? TName : `${TSource["name"]}_${JoinColumnNames<TColumns>}_${TSuffix}`;

export interface CheckConstraintConfig {
  expression: SQLQuery;
}

export interface UniqueConstraintConfig<TTable extends AnyTableDefinition> {
  table: TTable;
  columns: ColumnRefs<TTable["columns"]>[keyof TTable["columns"]][];
}

export interface PrimaryKeyConstraintConfig<TTable extends AnyTableDefinition> {
  table: TTable;
  columns: ColumnRefs<TTable["columns"]>[keyof TTable["columns"]][];
}

export const extractConstrainName = <
  TName extends string,
  TSource extends DefinitionNode,
  TColumns extends ColumnRef[],
  TSuffix extends string,
>(
  name: TName | undefined,
  source: NodeRef<TSource>,
  columns: TColumns,
  suffix: TSuffix
): InferConstraintName<TName, NodeRef<TSource>, TColumns, TSuffix> => {
  if (name) {
    return name as InferConstraintName<TName, NodeRef<TSource>, TColumns, TSuffix>;
  }

  const sourceName = source.name;
  const columnNames = columns.map((col) => col.name).join("_");

  return `${sourceName}_${columnNames}_${suffix}` as InferConstraintName<
    TName,
    NodeRef<TSource>,
    TColumns,
    TSuffix
  >;
};

export type AnyCheckConstraintDefinition = CheckConstraintDefinition<string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyUniqueConstraintDefinition = UniqueConstraintDefinition<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPrimaryKeyConstraintDefinition = PrimaryKeyConstraintDefinition<string, any>;

export type AnyConstraintDefinition =
  | AnyCheckConstraintDefinition
  | AnyUniqueConstraintDefinition
  | AnyPrimaryKeyConstraintDefinition;

export class CheckConstraintDefinition<TName extends string> extends DefinitionNode<
  TName,
  CheckConstraintConfig
> {
  readonly kind = Kind.CHECK_CONSTRAINT;

  protected _expression: CheckConstraintConfig["expression"];

  constructor(name: TName, config: CheckConstraintConfig) {
    super(name);

    this._expression = config.expression;
  }

  toJSON() {
    const { text } = this._expression.toQuery({ inlineParams: true });

    return {
      kind: this.kind,
      name: this.name,
      expression: text,
    } as const;
  }
}

export class UniqueConstraintDefinition<
  TName extends string,
  TTable extends AnyTableDefinition,
> extends DefinitionNode<TName, UniqueConstraintConfig<TTable>> {
  readonly kind = Kind.UNIQUE_CONSTRAINT;

  protected _table: TTable;
  protected _columns: UniqueConstraintConfig<TTable>["columns"];
  protected _include?: UniqueConstraintConfig<TTable>["columns"];
  protected _distinctNulls?: boolean;

  constructor(name: TName, config: UniqueConstraintConfig<TTable>) {
    super(name);

    this._columns = config.columns;
    this._table = config.table as TTable;
    this._distinctNulls = true;
  }

  public include(
    cb: (
      columns: ColumnRefs<TTable["columns"]>
    ) => ColumnRefs<TTable["columns"]>[keyof TTable["columns"]][]
  ): this {
    this._include = cb(this._table._getColumnRefs());
    return this;
  }

  public distinctNulls(distinct = true): this {
    this._distinctNulls = distinct;
    return this;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      columns: this._columns.map((col) => col.toJSON()),
      include: this._include ? this._include.map((col) => col.toJSON()) : null,
      distinctNulls: this._distinctNulls ?? null,
    } as const;
  }
}

export class PrimaryKeyConstraintDefinition<
  TName extends string,
  TTable extends AnyTableDefinition,
> extends DefinitionNode<TName, PrimaryKeyConstraintConfig<TTable>> {
  readonly kind = Kind.PRIMARY_KEY_CONSTRAINT;

  protected _table: TTable;
  protected _columns: PrimaryKeyConstraintConfig<TTable>["columns"];
  protected _include?: PrimaryKeyConstraintConfig<TTable>["columns"];

  constructor(name: TName, config: PrimaryKeyConstraintConfig<TTable>) {
    super(name);

    this._table = config.table as TTable;
    this._columns = config.columns;
  }

  public include(
    cb: (
      columns: ColumnRefs<TTable["columns"]>
    ) => ColumnRefs<TTable["columns"]>[keyof TTable["columns"]][]
  ): this {
    this._columns = cb(this._table._getColumnRefs());
    return this;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      columns: this._columns.map((col) => col.toJSON()),
      include: this._include ? this._include.map((col) => col.toJSON()) : null,
    } as const;
  }
}
