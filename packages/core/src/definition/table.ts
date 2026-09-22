import { SQLNode, SQLQuery } from "../sql/nodes.js";
import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import {
  AnyConstraintDefinition,
  CheckConstraintDefinition,
  PrimaryKeyConstraintDefinition,
  UniqueConstraintDefinition,
} from "./constraint.js";
import { AnyIndexDefinition, IndexConfig, IndexDefinition } from "./indexes.js";
import { AnyNamespaceDefinition } from "./namespace.js";

export interface TableConfig<
  TColumns extends Record<string, AnyColumnDefinition>,
  TSchema extends AnyNamespaceDefinition,
> {
  namespace?: NodeRef<TSchema>;
  columns: TColumns;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTableDefinition = TableDefinition<any, any, any>;

export type ColumnRefs<TColumns extends Record<string, AnyColumnDefinition>> = {
  readonly [K in keyof TColumns]: NodeRef<TColumns[K]>;
};

export class TableDefinition<
  TName extends string,
  TColumns extends Record<string, AnyColumnDefinition>,
  TNamespace extends AnyNamespaceDefinition,
> extends DefinitionNode<TName, TableConfig<TColumns, TNamespace>> {
  readonly kind = Kind.TABLE;

  protected _namespace?: NodeRef<TNamespace>;
  protected _indexes: AnyIndexDefinition[] = [];
  protected _constraints: AnyConstraintDefinition[] = [];

  readonly columns: Readonly<TColumns>;

  constructor(name: TName, config: TableConfig<TColumns, TNamespace>) {
    super(name);

    this._namespace = config.namespace;
    this.columns = config.columns as Readonly<TColumns>;

    this._assertDistinctColumnNames();
  }

  /**
   * Two fields mapping to one database column is always a mistake, and a silent one: the
   * result resolver reads a row by column name (`packages/core/src/runtime/operation.ts`),
   * so one field would shadow the other, and `toJSON` would emit the column twice.
   */
  private _assertDistinctColumnNames(): void {
    const fieldsByColumn = new Map<string, string>();

    for (const [field, column] of Object.entries(this.columns)) {
      const existing = fieldsByColumn.get(column.name);

      if (existing !== undefined) {
        throw new Error(
          `Table "${this.name}" maps fields "${existing}" and "${field}" to the same column ` +
            `"${column.name}". Every field must map to a distinct column.`
        );
      }

      fieldsByColumn.set(column.name, field);
    }
  }

  /** @internal */
  _getColumnRefs(): ColumnRefs<this["columns"]> {
    return Object.fromEntries(
      Object.entries(this.columns).map(([field, column]) => [field, new NodeRef(column)])
    ) as ColumnRefs<this["columns"]>;
  }

  public index<TIdxName extends string, TIdxConfig extends IndexConfig>(
    name: TIdxName,
    config: Partial<Omit<TIdxConfig, "table">> = {}
  ): IndexDefinition<TIdxName, this> {
    const idx = new IndexDefinition(name, { ...config, table: this });
    this._indexes.push(idx);

    return idx as IndexDefinition<TIdxName, this>;
  }

  public check(cb: (columns: ColumnRefs<this["columns"]>) => SQLNode, name?: string): this {
    const expression = new SQLQuery(cb(this._getColumnRefs()));
    this._constraints?.push(
      new CheckConstraintDefinition(name ?? `${this.name}_check`, { expression })
    );

    return this;
  }

  public unique(
    cb: (
      columns: ColumnRefs<this["columns"]>
    ) => ColumnRefs<this["columns"]>[keyof this["columns"]][]
  ): UniqueConstraintDefinition<string, this> {
    const cols = cb(this._getColumnRefs());

    const constraint = new UniqueConstraintDefinition(`${this.name}_unique`, {
      table: this,
      columns: cols,
    });
    this._constraints?.push(constraint);

    return constraint;
  }

  public primaryKey(
    cb: (
      columns: ColumnRefs<this["columns"]>
    ) => ColumnRefs<this["columns"]>[keyof this["columns"]][]
  ): PrimaryKeyConstraintDefinition<string, this> {
    const cols = cb(this._getColumnRefs());

    const constraint = new PrimaryKeyConstraintDefinition(`${this.name}_primary_key`, {
      table: this,
      columns: cols,
    });

    this._constraints?.push(constraint);

    return constraint;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      namespace: this._namespace?.name ?? "public",
      columns: Object.values(this.columns).map((col) => col.toJSON()),
      indexes: this._indexes.map((idx) => idx.toJSON()),
      constraints: this._constraints?.map((constraint) => constraint.toJSON()),
    } as const;
  }
}
