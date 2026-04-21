import { TypedObject } from "../utils/index.js";
import { ColumnConfig, ColumnDefinition } from "../definition/index.js";
import { SQLContext, SQLNode, SQLStatement, sql } from "../sql/index.js";
import { AnyTable } from "./table.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyColumn = Column<any, any, any>;

export class Column<TName extends string, TConfig extends ColumnConfig, TTable extends AnyTable>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: TConfig;

  readonly codec: ColumnDefinition<TName, TConfig>["_codec"];

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
  }

  public resolve(value: TConfig["rawType"]): TConfig["valueType"] {
    return this.codec.decode(value);
  }

  toSQL(ctx: SQLContext): SQLStatement {
    return sql.join([sql.identifier(this.table.name), sql.identifier(this.name)], ".").toSQL(ctx);
  }
}
