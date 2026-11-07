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
  UniqueConstraintDefinition,
  IndexColumnDefinition,
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
export type RecordMeta = {
  readonly key: string;
  readonly table: string;
  readonly schema?: string;
  readonly [field: string]: unknown;
};

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

/** A table's fields, without its deprecated columns: the client never sees those. */
export type TableColumnName<T extends AnyTable> = T["__type"] extends { columns: infer C }
  ? C extends Record<string, AnyColumnDefinition>
    ? {
        [K in keyof C]: C[K] extends { __type: { deprecated: true } } ? never : K;
      }[keyof C]
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
   * Every field set that names at most one row — the primary key, then each unique column,
   * unique constraint and unique index — each sorted, without repeats, the primary key first.
   *
   * A partial unique index is not a key (it is unique only where its predicate holds), and
   * neither is one over an expression, which no field can name. A key over a deprecated column
   * is left out: the client has no field for it.
   */
  readonly uniqueKeys: readonly (readonly string[])[];

  /**
   * What every row of this table reports about itself, surfaced as `$$meta` on each result
   * record — the built-in `key` / `table` / `schema` plus whatever `table().meta()` declared.
   *
   * Frozen and built once: the same object is shared by reference across every row of a
   * level, because nothing in it varies per row.
   */
  readonly meta: RecordMeta;

  private readonly _ref: SQLNode = new TableRef(this);

  /**
   * A table's relations are not held here: `SchemaRegistry` resolves them against the whole
   * schema (`getRelation`). `TRelations` only carries their types, for the client.
   */
  constructor(definition: TableDefinition<TName, TColumns, TNamespace>, alias?: string) {
    this.schema = definition["_namespace"]?.name as TableSchemaName<this>;
    this.name = definition.name;
    this.alias = alias ?? definition.name;
    this.columns = this._buildColumns(definition);
    this.primaryKey = this._buildPrimaryKey(definition);
    this.isCompositeKey = this.primaryKey.length > 1;
    this.uniqueKeys = this._buildUniqueKeys(definition);
    this.meta = this._buildMeta(definition);
  }

  private _buildColumns(
    definition: TableDefinition<TName, TColumns, TNamespace>
  ): TableColumns<this> {
    const columns = {} as Record<string, Column<string, ColumnConfig, this>>;

    for (const [name, def] of Object.entries(definition.columns)) {
      // Deprecated: still in the database until a later release drops it, but not the client's.
      if (def["_deprecated"]) continue;

      columns[name] = new Column(this, def);
    }

    return columns as TableColumns<this>;
  }

  private _buildPrimaryKey(definition: TableDefinition<TName, TColumns, TNamespace>): AnyColumn[] {
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

  private _buildUniqueKeys(
    definition: TableDefinition<TName, TColumns, TNamespace>
  ): readonly (readonly string[])[] {
    // Constraints and indexes name database columns; a key names fields.
    const fieldOf = new Map(this.getColumnEntries().map(([field, column]) => [column.name, field]));
    const keys = new Map<string, readonly string[]>();

    const add = (fields: (string | undefined)[]) => {
      if (fields.length === 0 || fields.some((field) => field === undefined)) {
        return;
      }

      const key = Object.freeze([...new Set(fields as string[])].sort());
      keys.set(key.join("\u0000"), key);
    };

    add(this.primaryKey.map((column) => fieldOf.get(column.name)));

    for (const [field, column] of this.getColumnEntries()) {
      if (column.unique) add([field]);
    }

    for (const constraint of definition["_constraints"]) {
      if (constraint instanceof UniqueConstraintDefinition) {
        add(constraint["_columns"].map((ref: { name: string }) => fieldOf.get(ref.name)));
      }
    }

    for (const index of definition["_indexes"]) {
      const columns = index["_columns"];

      if (
        !index["_unique"] ||
        index["_where"] ||
        columns.some((column) => !(column instanceof IndexColumnDefinition))
      ) {
        continue;
      }

      add(
        columns.map((column) =>
          fieldOf.get(
            (column as IndexColumnDefinition<string, AnyColumnDefinition>)["_column"].name
          )
        )
      );
    }

    return Object.freeze([...keys.values()]);
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
