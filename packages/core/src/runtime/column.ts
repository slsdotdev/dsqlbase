import { TypedObject } from "../utils/index.js";
import { ColumnConfig, ColumnDefinition } from "../definition/index.js";
import { SQLContext, SQLNode, SQLParam, SQLStatement, isSQLNode, sql } from "../sql/index.js";
import { AnyTable } from "./table.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyColumn = Column<any, any, any>;

export class Column<TName extends string, TConfig extends ColumnConfig, TTable extends AnyTable>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: TConfig;

  readonly codec: ColumnDefinition<TName, TConfig>["_codec"];
  readonly onCreate: ColumnDefinition<TName, TConfig>["_onCreate"];
  readonly onUpdate: ColumnDefinition<TName, TConfig>["_onUpdate"];

  readonly table: TTable;
  readonly name: TName;
  readonly notNull: TConfig["notNull"];
  readonly primaryKey: TConfig["primaryKey"];
  readonly unique: TConfig["unique"];

  constructor(table: TTable, definition: ColumnDefinition<TName, TConfig>) {
    this.table = table;
    this.name = definition.name;
    this.notNull = definition["_notNull"];
    this.primaryKey = definition["_primaryKey"];
    this.unique = definition["_unique"];

    this.codec = definition["_codec"];
    this.onCreate = definition["_onCreate"];
    this.onUpdate = definition["_onUpdate"];
  }

  public resolve(value: TConfig["rawType"]): TConfig["valueType"] {
    if (value === null || value === undefined) {
      if (this.notNull) {
        throw new Error(`Column ${this.name} cannot be null`);
      }

      return null;
    }

    return this.codec.decode(value);
  }

  public getInsertValue(
    value: TConfig["valueType"] | null | undefined | SQLParam<TConfig["valueType"]>
  ) {
    let param = value ?? undefined;

    if (param === undefined) {
      param = this.onCreate?.() ?? sql.raw("DEFAULT");
    }

    if (param instanceof SQLParam) {
      param = new SQLParam(param["_value"], this.codec.encode);
    }

    if (!isSQLNode(param)) {
      param = new SQLParam(param, this.codec.encode);
    }

    return param as SQLNode;
  }

  getUpdateValue(value: TConfig["valueType"] | null | undefined | SQLParam<TConfig["valueType"]>) {
    let param = value;

    if (param === undefined) {
      param = this.onUpdate?.() ?? undefined;
    }

    if (param instanceof SQLParam) {
      param = new SQLParam(param["_value"], this.codec.encode);
    }

    if (value !== undefined && !isSQLNode(param)) {
      param = new SQLParam(param, this.codec.encode);
    }

    return param as SQLNode;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    return sql.join([sql.identifier(this.table.name), sql.identifier(this.name)], ".").toSQL(ctx);
  }
}
