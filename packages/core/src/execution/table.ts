import { TypedObject } from "../types/object.js";
import { ColumnConfig, ColumnDefinition } from "../definition/column.js";
import { SchemaDefinition } from "../definition/schema.js";
import { TableConfig, TableDefinition } from "../definition/table.js";
import { SQLBuildContext, SQLNode, SQLStatement } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import { Column } from "./column.js";

export type AnyTable = Table<string, TableConfig>;

export type SchemaNameOf<T extends TableConfig> = T extends { schema: infer S }
  ? S extends SchemaDefinition<infer SN>
    ? SN
    : never
  : undefined;

export type ColumsOf<T extends AnyTable> = T["__type"] extends { columns: infer C }
  ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
    C extends Record<infer CKey, infer _CDef>
    ? {
        readonly [K in CKey]: C[K] extends ColumnDefinition<infer CName, infer CConfig>
          ? Column<T, CName, CConfig>
          : never;
      }
    : never
  : never;

export type ColumnNamesOf<T extends AnyTable> = T["__type"] extends { columns: infer C }
  ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
    C extends Record<infer CKey, infer _CDef>
    ? CKey
    : never
  : never;

export type RecordOf<T extends AnyTable> = T["__type"] extends { columns: infer C }
  ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
    C extends Record<infer CKey, infer CDef>
    ? {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        [K in CKey]: C[K] extends ColumnDefinition<infer _CName, infer CConfig>
          ? CConfig extends { notNull: true }
            ? string
            : string | null | undefined
          : never;
      }
    : never
  : never;

export class Table<TName extends string, TConfig extends TableConfig>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: TConfig;

  readonly schema: SchemaNameOf<TConfig>;
  readonly columns: ColumsOf<this>;
  readonly name: TName;

  constructor(definition: TableDefinition<TName, TConfig>) {
    this.schema = definition["_schema"]?.name as SchemaNameOf<TConfig>;
    this.name = definition.name;
    this.columns = this._buildColumns(definition);
  }

  private _buildColumns(definition: TableDefinition<TName, TConfig>): ColumsOf<this> {
    const columns = {} as Record<string, Column<this, string, ColumnConfig>>;

    for (const [name, def] of Object.entries(definition["_columns"])) {
      columns[name] = new Column(this, def);
    }

    return columns as ColumsOf<this>;
  }

  public toSQL(ctx: SQLBuildContext): SQLStatement {
    if (this.schema) {
      return sql.join([sql.identifier(this.schema), sql.identifier(this.name)], ".").toSQL(ctx);
    }

    return sql.identifier(this.name).toSQL();
  }
}
