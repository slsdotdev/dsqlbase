import { TypedObject } from "../utils/index.js";
import {
  AnyColumnDefinition,
  AnyTableRelations,
  ColumnConfig,
  ColumnDefinition,
  AnyNamespaceDefinition,
  TableConfig,
  TableDefinition,
  NamespaceDefinition,
} from "../definition/index.js";
import { sql, SQLContext, SQLNode, SQLStatement } from "../sql/index.js";
import { Column } from "./column.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTable = Table<any, any, any, any>;

export type WithRelations<
  TColumns extends Record<string, AnyColumnDefinition>,
  TNamespace extends AnyNamespaceDefinition,
  TRelations extends AnyTableRelations | undefined,
> = TableConfig<TColumns, TNamespace> & {
  relations: TRelations extends AnyTableRelations ? TRelations : never;
};

export type TableSchemaName<T extends AnyTable> = T["__type"] extends { schema: infer S }
  ? S extends NamespaceDefinition<infer SN>
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
        ? Column<CName, CConfig, T>
        : never
      : never
    : never;
};

export class Table<
  TName extends string,
  TColumns extends Record<string, AnyColumnDefinition>,
  TNamespace extends AnyNamespaceDefinition,
  TRelations extends AnyTableRelations,
>
  implements SQLNode, TypedObject<TableConfig<TColumns, TNamespace>>
{
  declare readonly __type: WithRelations<TColumns, TNamespace, TRelations>;

  readonly name: TName;
  readonly schema: TableSchemaName<this>;
  readonly columns: TableColumns<this>;
  readonly relations: TRelations;

  constructor(definition: TableDefinition<TName, TColumns, TNamespace>, relations?: TRelations) {
    this.schema = definition["_namespace"]?.name as TableSchemaName<this>;
    this.name = definition.name;
    this.columns = this._buildColumns(definition);
    this.relations = relations as TRelations;
  }

  private _buildColumns(
    definition: TableDefinition<TName, TColumns, TNamespace>
  ): TableColumns<this> {
    const columns = {} as Record<string, Column<string, ColumnConfig, this>>;

    for (const [name, def] of Object.entries(definition.columns)) {
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

    return Object.values<Column<string, ColumnConfig, this>>(this.columns).find(
      (col) => col.name === name
    );
  }

  public getColumnEntries(): [string, Column<string, ColumnConfig, this>][] {
    return Object.entries(this.columns);
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
