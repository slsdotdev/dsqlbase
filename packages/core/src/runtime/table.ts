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
  PrimaryKeyConstraintDefinition,
} from "../definition/index.js";
import { sql, SQLContext, SQLNode, SQLStatement } from "../sql/index.js";
import { AnyColumn, Column } from "./column.js";

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

  /**
   * The key this table is exported under in the schema object — the name the client
   * addresses it by (`dsql.members`), which may differ from the database table name
   * (`team_members`). Set by `SchemaRegistry`; defaults to `name` when a `Table` is
   * constructed directly.
   */
  readonly alias: string;

  readonly schema: TableSchemaName<this>;
  readonly columns: TableColumns<this>;
  readonly relations: TRelations;

  /**
   * The columns of the table's primary key, in key order. Empty when the table declares none.
   *
   * A table has at most one primary key; a composite key is that one key spanning several
   * columns. Declaring more than one — two flagged columns, a flagged column alongside a
   * table-level constraint, or two table-level constraints — throws when the table is built.
   */
  readonly primaryKey: AnyColumn[];

  /** True when the primary key spans more than one column. */
  readonly isCompositeKey: boolean;

  constructor(
    definition: TableDefinition<TName, TColumns, TNamespace>,
    relations?: TRelations,
    alias?: string
  ) {
    this.schema = definition["_namespace"]?.name as TableSchemaName<this>;
    this.name = definition.name;
    this.alias = alias ?? definition.name;
    this.columns = this._buildColumns(definition);
    this.primaryKey = this._buildPrimaryKey(definition);
    this.isCompositeKey = this.primaryKey.length > 1;
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

  private _buildPrimaryKey(
    definition: TableDefinition<TName, TColumns, TNamespace>
  ): AnyColumn[] {
    const flagged = this.getColumnEntries().filter(([, column]) => column.primaryKey);
    const constraints = definition["_constraints"].filter(
      (constraint) => constraint instanceof PrimaryKeyConstraintDefinition
    );

    const declarations = [
      ...flagged.map(([field]) => `column "${field}"`),
      ...constraints.map((constraint) => `constraint "${constraint.name}"`),
    ];

    if (declarations.length > 1) {
      throw new Error(
        `Table "${this.name}" declares more than one primary key (${declarations.join(", ")}). ` +
          `A table has at most one primary key; use table.primaryKey((c) => [...]) for a composite key.`
      );
    }

    const constraint = constraints[0];

    if (!constraint) {
      return flagged.map(([, column]) => column);
    }

    return constraint["_columns"].map((ref) => {
      const column = this.getColumn(ref.name);

      if (!column) {
        throw new Error(
          `Primary key constraint "${constraint.name}" on table "${this.name}" references unknown column "${ref.name}"`
        );
      }

      return column;
    });
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
