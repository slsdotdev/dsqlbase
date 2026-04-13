import { TypedObject } from "../types/object.js";
import { ColumnConfig, ColumnDefinition } from "../definition/column.js";
import { SchemaDefinition } from "../definition/schema.js";
import { TableConfig, TableDefinition } from "../definition/table.js";
import { SQLContext, SQLNode, SQLStatement } from "../sql/nodes.js";
import { sql } from "../sql/tag.js";
import { AnyColumn, Column } from "./column.js";
import { Relation } from "../definition/relations.js";

export type AnyTable = Table<
  string,
  TableConfig,
  | Record<
      string,
      Relation<TableDefinition<string, TableConfig>, TableDefinition<string, TableConfig>>
    >
  | undefined
>;

export type WithRelations<
  T extends TableConfig,
  TRelations extends
    | Record<
        string,
        Relation<TableDefinition<string, TableConfig>, TableDefinition<string, TableConfig>>
      >
    | undefined,
> = T & {
  relations: TRelations extends Record<
    string,
    Relation<TableDefinition<string, TableConfig>, TableDefinition<string, TableConfig>>
  >
    ? TRelations
    : never;
};

export type SchemaNameOf<T extends AnyTable> = T["__type"] extends { schema: infer S }
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

export class Table<
  TName extends string,
  TConfig extends TableConfig,
  TRelations extends Record<string, Relation<TableDefinition<TName, TConfig>>> | undefined =
    undefined,
>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: WithRelations<TConfig, TRelations>;

  readonly name: TName;
  readonly schema: SchemaNameOf<this>;
  readonly columns: ColumsOf<this>;
  readonly relations: TRelations;

  constructor(definition: TableDefinition<TName, TConfig>, relations?: TRelations) {
    this.schema = definition["_schema"]?.name as SchemaNameOf<this>;
    this.name = definition.name;
    this.columns = this._buildColumns(definition);
    this.relations = relations as TRelations;
  }

  private _buildColumns(definition: TableDefinition<TName, TConfig>): ColumsOf<this> {
    const columns = {} as Record<string, Column<this, string, ColumnConfig>>;

    for (const [name, def] of Object.entries(definition["_columns"])) {
      columns[name] = new Column(this, def);
    }

    return columns as ColumsOf<this>;
  }

  public hasColumn(name: string): boolean {
    return Object.hasOwn(this.columns, name);
  }

  public getColumn(name: string) {
    if (this.columns[name]) {
      return this.columns[name];
    }

    return Object.values<AnyColumn>(this.columns).find((col) => col.name === name);
  }

  public toSQL(ctx: SQLContext): SQLStatement {
    if (this.schema) {
      return sql.join([sql.identifier(this.schema), sql.identifier(this.name)], ".").toSQL(ctx);
    }

    return sql.identifier(this.name).toSQL();
  }
}
