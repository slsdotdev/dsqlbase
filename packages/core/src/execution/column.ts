import { TypedObject } from "../types/object.js";
import { ColumnConfig, ColumnDefinition } from "../definition/column.js";
import { SQLContext, SQLNode, SQLStatement, sql } from "../sql/index.js";
import { AnyTable } from "./table.js";

export type AnyColumn = Column<AnyTable, string, ColumnConfig>;

export class Column<TTable extends AnyTable, TName extends string, TConfig extends ColumnConfig>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: TConfig;

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
  }

  toSQL(ctx: SQLContext): SQLStatement {
    return sql.join([sql.identifier(this.table.name), sql.identifier(this.name)], ".").toSQL(ctx);
  }
}
