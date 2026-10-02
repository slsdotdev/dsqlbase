import { TypedObject } from "../utils/index.js";
import {
  AnyColumnGroupDefinition,
  ColumnGroupConfig,
  ColumnGroupDefinition,
  TableColumnDefinitions,
} from "../definition/index.js";
import { AnyColumn, Column } from "./column.js";
import type { AnyTable } from "./table.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyColumnGroup = ColumnGroup<any, any, any>;

/** A member of a group, or of a table: a column, or a group of them. */
export type AnyField = AnyColumn | AnyColumnGroup;

/**
 * Which members of a group a read selects, as the operation receives it: each member with the
 * column or group it resolves to, and for a group the members selected within it — none meaning
 * all of them.
 */
export type GroupSelection = [field: string, member: AnyField, selection?: GroupSelection][];

/** How a group is read: the columns to project, and how a row becomes the group's value. */
export type GroupReader = {
  readonly columns: AnyColumn[];
  resolve(row: Record<string, unknown>): Record<string, unknown> | null;
};

/**
 * An embedded object placed in a table, at runtime: its members as built columns and groups.
 *
 * The group owns how it is read. Its columns are projected like any others, and the value is
 * built from the row by {@link ColumnGroup.reader} — a resolver beside the column ones, not a
 * column. A group is `null` exactly when it is {@link ColumnGroup.nullable} and every one of its
 * columns is `NULL`; deciding that needs all of them, so a nullable group projects every column
 * whatever the selection, and emits only the selected ones.
 */
export class ColumnGroup<
  TName extends string,
  TColumns extends TableColumnDefinitions,
  TTable extends AnyTable,
> implements TypedObject<ColumnGroupConfig<TColumns, boolean>> {
  declare readonly __type: ColumnGroupConfig<TColumns, boolean>;

  readonly table: TTable;
  /** The prefix of the group's columns — `net_value` for `net_value_amount`. */
  readonly name: TName;
  readonly columns: Readonly<Record<string, AnyField>>;

  /** True when every member, nested groups included, is nullable: the group can be absent. */
  readonly nullable: boolean;

  constructor(table: TTable, definition: ColumnGroupDefinition<TName, TColumns, boolean>) {
    this.table = table;
    this.name = definition.name;

    const columns: Record<string, AnyField> = {};

    for (const [field, member] of Object.entries(definition.columns)) {
      columns[field] =
        member instanceof ColumnGroupDefinition
          ? new ColumnGroup(table, member as AnyColumnGroupDefinition)
          : new Column(table, member);
    }

    this.columns = Object.freeze(columns);
    this.nullable = Object.values(columns).every((member) =>
      member instanceof ColumnGroup ? member.nullable : !member.notNull
    );
  }

  public hasColumn(field: string): boolean {
    return Object.hasOwn(this.columns, field);
  }

  public getColumn(field: string): AnyField | undefined {
    return this.hasColumn(field) ? this.columns[field] : undefined;
  }

  /** Every column under the group, nested groups walked depth first. */
  public leafColumns(): AnyColumn[] {
    return Object.values(this.columns).flatMap((member) =>
      member instanceof ColumnGroup ? member.leafColumns() : [member]
    );
  }

  /**
   * How to read the group under `selection` — every member when it names none. A member column
   * with a row decoder brings the columns it reads, as it does at table level.
   */
  public reader(selection?: GroupSelection): GroupReader {
    const entries: GroupSelection =
      selection && selection.length > 0
        ? selection
        : Object.entries(this.columns).map(([field, member]) => [field, member]);

    const columns: AnyColumn[] = [];
    const fields: [string, (row: Record<string, unknown>) => unknown][] = [];

    const project = (column: AnyColumn) => {
      if (!columns.includes(column)) {
        columns.push(column);
      }
    };

    for (const [field, member, nested] of entries) {
      if (this.columns[field] !== member) {
        throw new Error(`Group "${this.name}" on "${this.table.name}" has no member "${field}".`);
      }

      if (member instanceof ColumnGroup) {
        const reader = member.reader(nested);
        reader.columns.forEach(project);
        fields.push([field, (row) => reader.resolve(row)]);
        continue;
      }

      project(member);
      member.rowDecoder?.dependsOn.forEach(project);
      fields.push([field, (row) => member.resolveRow(row)]);
    }

    const presence = this.nullable ? this.leafColumns() : [];
    presence.forEach(project);

    return {
      columns,
      resolve: (row) => {
        if (this.nullable && presence.every((column) => row[column.name] == null)) {
          return null;
        }

        return Object.fromEntries(fields.map(([field, read]) => [field, read(row)]));
      },
    };
  }
}
