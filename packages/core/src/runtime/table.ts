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

/**
 * What a row reports about the table it came from, written to every result record as
 * `$$meta` (`packages/core/src/runtime/operation.ts`).
 *
 * `key` is the schema alias — the name the client addresses the table by, and the intended
 * discriminant when a row could have come from one of several tables. `table` is the
 * database name, which may differ.
 */
export interface RecordMeta {
  readonly key: string;
  readonly table: string;
  readonly schema?: string;
  readonly [field: string]: unknown;
}

/** Meta keys the runtime owns; `table().meta()` may not redeclare them. */
const BUILT_IN_META_KEYS: readonly string[] = Object.freeze(["key", "table", "schema"]);

/**
 * How a table is named when it *qualifies a column* — the alias bound for it in the
 * rendering context, or its bare name when none is.
 *
 * Counterpart to `Table.toSQL`, which renders the table as a *source*
 * (`"billing"."invoices"`, for `FROM` / `UPDATE` / `INSERT INTO`). A source says *which
 * table*, so it carries the schema; a reference says *which correlation in this query*,
 * where the schema is not part of the name.
 *
 * Deliberately **not** schema-qualified when unaliased, for two reasons Postgres enforces:
 * once a source is aliased, `"billing"."invoices"."id"` is rejected outright with
 * `invalid reference to FROM-clause entry`; and schema-qualifying would not rescue an
 * unaliased shadowed subquery anyway, because that needs *both* sides qualified and a table
 * declared without a namespace has no schema to qualify with. Aliasing is the fix; this
 * fallback only ever runs where exactly one table is in scope (DML, `$query`).
 */
class TableRef implements SQLNode {
  private readonly _table: AnyTable;

  constructor(table: AnyTable) {
    this._table = table;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    return sql.identifier(ctx.aliases?.get(this._table) ?? this._table.name).toSQL(ctx);
  }
}

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

  /**
   * The table's tenant claim columns, paired with the claim they are filled from, in
   * declaration order. Empty for a table outside any tenant scope.
   *
   * The claim is the *field* name, not the database column name: it is the key the runtime
   * looks up in `ExecutionContext.identity`, and the name `tenantScope()` declared it under.
   */
  readonly tenantKeys: [claim: string, column: AnyColumn][];

  /**
   * What every row of this table reports about itself, surfaced as `$$meta` on each result
   * record — the built-in `key` / `table` / `schema` plus whatever `table().meta()` declared.
   *
   * Frozen and built once: the same object is shared by reference across every row of a
   * level, because nothing in it varies per row.
   */
  readonly meta: RecordMeta;

  private readonly _ref: SQLNode = new TableRef(this);

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
    this.tenantKeys = this.getColumnEntries().filter(([, column]) => column.tenantKey);
    this.meta = this._buildMeta(definition);
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

  private _buildMeta(definition: TableDefinition<TName, TColumns, TNamespace>): RecordMeta {
    const declared = definition["_meta"] ?? {};

    for (const key of Object.keys(declared)) {
      if (BUILT_IN_META_KEYS.includes(key)) {
        throw new Error(
          `Table "${this.name}" declares meta key "${key}", which is built in. ` +
            `${BUILT_IN_META_KEYS.join(", ")} are set from the schema and cannot be overridden.`
        );
      }
    }

    return Object.freeze({
      key: this.alias,
      table: this.name,
      ...(this.schema ? { schema: this.schema as string } : {}),
      ...declared,
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

  /**
   * The node that names this table when qualifying a column: the alias bound in the
   * rendering context, else the table name. Cached — it holds no per-render state.
   */
  public ref(): SQLNode {
    return this._ref;
  }

  public toSQL(ctx: SQLContext): SQLStatement {
    if (this.schema) {
      return sql.join([sql.identifier(this.schema), sql.identifier(this.name)], ".").toSQL(ctx);
    }

    return sql.identifier(this.name).toSQL(ctx);
  }
}
