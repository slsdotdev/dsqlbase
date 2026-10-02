import { WithMeta } from "../utils/types.js";
import { SQLNode, SQLQuery } from "../sql/nodes.js";
import { DefinitionNode, Kind, NodeRef, RESERVED_FIELD_NAMES } from "./base.js";
import {
  ColumnGroupDefinition,
  ColumnRefOf,
  ColumnRefs,
  columnEntries,
  TableColumnDefinitions,
} from "./embedded.js";
import {
  AnyConstraintDefinition,
  CheckConstraintDefinition,
  PrimaryKeyConstraintDefinition,
  UniqueConstraintDefinition,
} from "./constraint.js";
import { AnyIndexDefinition, IndexConfig, IndexDefinition } from "./indexes.js";
import { AnyNamespaceDefinition } from "./namespace.js";

export type TableConfig<
  TColumns extends TableColumnDefinitions,
  TSchema extends AnyNamespaceDefinition,
> = {
  namespace?: NodeRef<TSchema>;
  columns: TColumns;
  /**
   * Arbitrary per-table metadata, surfaced on every result row as part of `$$meta`.
   * Describes the table to the application, never to the database: it is not DDL and is
   * deliberately absent from {@link TableDefinition.toJSON}, so it never reaches a migration.
   */
  meta?: unknown;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTableDefinition = TableDefinition<any, any, any>;

export type { ColumnRefOf, ColumnRefs };

export class TableDefinition<
  TName extends string,
  TColumns extends TableColumnDefinitions,
  TNamespace extends AnyNamespaceDefinition,
> extends DefinitionNode<TName, TableConfig<TColumns, TNamespace>> {
  readonly kind = Kind.TABLE;

  protected _namespace?: NodeRef<TNamespace>;
  protected _indexes: AnyIndexDefinition[] = [];
  protected _constraints: AnyConstraintDefinition[] = [];
  protected _meta?: Record<string, unknown>;

  readonly columns: Readonly<TColumns>;

  constructor(name: TName, config: TableConfig<TColumns, TNamespace>) {
    super(name);

    this._namespace = config.namespace;
    this.columns = config.columns as Readonly<TColumns>;
    this._meta = config.meta as Record<string, unknown> | undefined;

    this._assertReservedFieldNames();
    this._assertDistinctColumnNames();
    this._assertTenantKeys();
  }

  /**
   * Field names the runtime writes onto result records itself cannot also be columns —
   * one would overwrite the other. Checked here rather than at `Table` build time so the
   * error names the definition the author wrote.
   */
  private _assertReservedFieldNames(): void {
    for (const field of Object.keys(this.columns)) {
      if (RESERVED_FIELD_NAMES.includes(field)) {
        throw new Error(
          `Table "${this.name}" declares a column named "${field}", which is reserved. ` +
            `The runtime writes ${RESERVED_FIELD_NAMES.join(" and ")} onto every result row.`
        );
      }
    }
  }

  /**
   * Two fields mapping to one database column is always a mistake, and a silent one: the
   * result resolver reads a row by column name (`packages/core/src/runtime/operation.ts`),
   * so one field would shadow the other, and `toJSON` would emit the column twice. A group's
   * members count by their full path, so `netValue.amount` against a plain `net_value_amount`
   * is caught too.
   */
  private _assertDistinctColumnNames(): void {
    const fieldsByColumn = new Map<string, string>();

    for (const [path, column] of columnEntries(this.columns)) {
      const field = path.join(".");
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

  /**
   * A tenant claim column is filled by the runtime on every insert and AND-ed into every read,
   * so it can be neither null nor writable by the caller. `tenantScope()` sets both flags when
   * it hands the column over; this catches a column configured as a claim key any other way,
   * and catches it here — where the error can name the definition the author wrote.
   */
  private _assertTenantKeys(): void {
    for (const [path, column] of columnEntries(this.columns)) {
      const field = path.join(".");
      if (!column["_tenantKey"]) {
        continue;
      }

      if (!column["_notNull"]) {
        throw new Error(
          `Table "${this.name}" declares claim "${field}" as nullable. A claim column is ` +
            `filled by the runtime on every insert, so it is never null.`
        );
      }

      if (!column["_readOnly"]) {
        throw new Error(
          `Table "${this.name}" declares claim "${field}" as writable. A claim column's value ` +
            `comes from the identity on the client, never from the caller.`
        );
      }
    }
  }

  /** @internal */
  _getColumnRefs(): ColumnRefs<this["columns"]> {
    return Object.fromEntries(
      Object.entries(this.columns).map(([field, column]) => [
        field,
        column instanceof ColumnGroupDefinition ? column._getColumnRefs() : new NodeRef(column),
      ])
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
    cb: (columns: ColumnRefs<this["columns"]>) => ColumnRefOf<this["columns"]>[]
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
    cb: (columns: ColumnRefs<this["columns"]>) => ColumnRefOf<this["columns"]>[]
  ): PrimaryKeyConstraintDefinition<string, this> {
    const cols = cb(this._getColumnRefs());
    const members = new Set(
      columnEntries(this.columns)
        .filter(([path]) => path.length > 1)
        .map(([, column]) => column.name)
    );

    for (const ref of cols) {
      if (members.has(ref.name)) {
        throw new Error(
          `Table "${this.name}" declares a primary key on "${ref.name}", a member of an ` +
            `embedded object. A primary key spans plain columns only.`
        );
      }
    }

    const constraint = new PrimaryKeyConstraintDefinition(`${this.name}_primary_key`, {
      table: this,
      columns: cols,
    });

    this._constraints?.push(constraint);

    return constraint;
  }

  /**
   * Attaches arbitrary metadata to the table, surfaced on every result row under `$$meta`
   * alongside the built-in `key`, `table` and `schema`.
   *
   * Metadata describes the table to the application — a GraphQL typename, a display label —
   * and never to the database: it is absent from {@link TableDefinition.toJSON}, so it does
   * not participate in migrations. Built-in keys may not be overwritten; that throws when the
   * runtime `Table` is built.
   *
   * @example
   * ```ts
   * const users = table("users", { id: uuid("id").primaryKey() }).meta({ __typename: "User" });
   * // row.$$meta.__typename === "User"
   * ```
   */
  public meta<M extends Record<string, unknown>>(meta: M): WithMeta<this, M> {
    this._meta = meta;

    return this as WithMeta<this, M>;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      namespace: this._namespace?.name ?? "public",
      columns: columnEntries(this.columns).map(([, column]) => column.toJSON()),
      indexes: this._indexes.map((idx) => idx.toJSON()),
      constraints: this._constraints?.map((constraint) => constraint.toJSON()),
    } as const;
  }
}
