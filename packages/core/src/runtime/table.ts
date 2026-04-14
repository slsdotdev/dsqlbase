import { TypedObject } from "../utils/index.js";
import {
  AnyColumnDefinition,
  AnyTableRelations,
  ColumnDefinition,
  SchemaDefinition,
  TableConfig,
  TableDefinition,
} from "../definition/index.js";
import { sql, SQLContext, SQLNode, SQLStatement } from "../sql/index.js";
import { AnyColumn, Column } from "./column.js";

export type AnyTable = Table<string, TableConfig, AnyTableRelations | undefined>;

export type WithRelations<
  T extends TableConfig,
  TRelations extends AnyTableRelations | undefined,
> = T & {
  relations: TRelations extends AnyTableRelations ? TRelations : never;
};

export type TableSchemaName<T extends AnyTable> = T["__type"] extends { schema: infer S }
  ? S extends SchemaDefinition<infer SN>
    ? SN
    : never
  : undefined;

export type TableColumnName<T extends AnyTable> = T["__type"] extends { columns: infer C }
  ? C extends Record<string, AnyColumnDefinition>
    ? keyof C
    : never
  : never;

export type TableColumns<T extends AnyTable> = {
  readonly [K in TableColumnName<T>]: T["__type"] extends { columns: infer C }
    ? C extends Record<K, infer CD>
      ? CD extends ColumnDefinition<infer CName, infer CConfig>
        ? Column<T, CName, CConfig>
        : never
      : never
    : never;
};

export class Table<
  TName extends string,
  TConfig extends TableConfig,
  TRelations extends AnyTableRelations | undefined = undefined,
>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: WithRelations<TConfig, TRelations>;

  readonly name: TName;
  readonly schema: TableSchemaName<this>;
  readonly columns: TableColumns<this>;
  readonly relations: TRelations;

  constructor(definition: TableDefinition<TName, TConfig>, relations?: TRelations) {
    this.schema = definition["_schema"]?.name as TableSchemaName<this>;
    this.name = definition.name;
    this.columns = this._buildColumns(definition);
    this.relations = relations as TRelations;
  }

  private _buildColumns(definition: TableDefinition<TName, TConfig>): TableColumns<this> {
    const columns = {} as Record<string, AnyColumn>;

    for (const [name, def] of Object.entries(definition["_columns"])) {
      columns[name] = new Column(this, def);
    }

    return columns as TableColumns<this>;
  }

  public hasColumn(name: string): boolean {
    return Object.hasOwn(this.columns, name);
  }

  public getColumn(name: string) {
    if (this.columns[name as TableColumnName<this>]) {
      return this.columns[name as TableColumnName<this>];
    }

    return Object.values<AnyColumn>(this.columns).find((col) => col.name === name);
  }

  public hasRelation(fieldName: string): boolean {
    return this.relations ? Object.hasOwn(this.relations, fieldName) : false;
  }

  public getRelation(fieldName: string) {
    if (!this.relations || !this.relations[fieldName]) {
      return undefined;
    }

    return this.relations[fieldName];
  }

  public toSQL(ctx: SQLContext): SQLStatement {
    if (this.schema) {
      return sql.join([sql.identifier(this.schema), sql.identifier(this.name)], ".").toSQL(ctx);
    }

    return sql.identifier(this.name).toSQL(ctx);
  }
}
