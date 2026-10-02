import { HasDefault } from "../utils/index.js";
import { DefinitionNode, Kind, NodeRef, RESERVED_FIELD_NAMES } from "./base.js";
import { AnyColumnDefinition, ColumnDefinition } from "./column.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyColumnGroupDefinition = ColumnGroupDefinition<string, any, any>;

/**
 * Matches a column group by its `kind` rather than by class: comparing a column against the
 * class structurally is costly enough, across a schema's tables, to exhaust the checker.
 */
export type GroupOf<TColumns extends TableColumnDefinitions> = {
  readonly kind: "COLUMN_GROUP";
  readonly columns: Readonly<TColumns>;
};

/** What a table's `columns` — and an embedded object's — hold: a column, or a group of them. */
export type AnyTableColumnDefinition = AnyColumnDefinition | AnyColumnGroupDefinition;

export type TableColumnDefinitions = Record<string, AnyTableColumnDefinition>;

/**
 * Column refs for a table's — or a group's — columns, as the `check`, `unique`, `primaryKey`
 * and `index` callbacks receive them: a column is a ref, a group the refs of its own columns,
 * so a member reads `c.netValue.amount`.
 */
export type ColumnRefs<TColumns extends TableColumnDefinitions> = {
  readonly [K in keyof TColumns]: TColumns[K] extends GroupOf<infer TGroupColumns>
    ? ColumnRefs<TGroupColumns>
    : NodeRef<TColumns[K]>;
};

/** Any one column ref in {@link ColumnRefs}, however deep. */
export type ColumnRefOf<TColumns extends TableColumnDefinitions> = {
  [K in keyof TColumns]: TColumns[K] extends GroupOf<infer TGroupColumns>
    ? ColumnRefOf<TGroupColumns>
    : NodeRef<TColumns[K]>;
}[keyof TColumns];

type MemberDefaultOf<TMember> =
  TMember extends GroupOf<infer TColumns>
    ? GroupDefaultOf<TColumns>
    : TMember extends { __type: { inputType: infer TInput } }
      ? TInput
      : never;

/** What `.default()` on a group takes: a value for any of its members, nested groups included. */
export type GroupDefaultOf<TColumns extends TableColumnDefinitions> = {
  [K in keyof TColumns]?: MemberDefaultOf<TColumns[K]>;
};

export type ColumnGroupConfig<
  TColumns extends TableColumnDefinitions,
  THasDefault extends boolean,
> = {
  columns: TColumns;
  hasDefault: THasDefault;
};

/**
 * A reusable set of columns — a value object such as `Money` or `Address` — that a table embeds
 * as real columns through {@link EmbeddedObjectDefinition.column}.
 *
 * The object itself is never placed in a table and produces no DDL. Its members are templates:
 * each `.column()` copies them under a prefixed name, so one object placed twice, on one table
 * or several, never shares a definition.
 */
export class EmbeddedObjectDefinition<
  TColumns extends TableColumnDefinitions,
> extends DefinitionNode<"embedded", { columns: TColumns }> {
  readonly kind = Kind.EMBEDDED_OBJECT;

  readonly columns: Readonly<TColumns>;

  constructor(columns: TColumns) {
    super("embedded");

    for (const [field, member] of Object.entries(columns)) {
      if (RESERVED_FIELD_NAMES.includes(field)) {
        throw new Error(
          `An embedded object declares a member named "${field}", which is reserved. ` +
            `The runtime writes ${RESERVED_FIELD_NAMES.join(" and ")} onto every result row.`
        );
      }

      if (member instanceof ColumnGroupDefinition) {
        continue;
      }

      if (!(member instanceof ColumnDefinition)) {
        throw new Error(`Embedded object member "${field}" is neither a column nor a group.`);
      }

      if (member["_primaryKey"]) {
        throw new Error(
          `Embedded object member "${field}" is a primary key. A key belongs to the table, ` +
            `not to an object that may be embedded several times.`
        );
      }

      if (member["_tenantKey"]) {
        throw new Error(
          `Embedded object member "${field}" is a tenant claim. A claim column belongs to the ` +
            `table's tenant scope, not to an embedded object.`
        );
      }
    }

    this.columns = Object.freeze({ ...columns });
  }

  /**
   * Embeds this object in a table as the group `name`: one real column per member, named
   * `<name>_<member>` — `money.column("net_value")` gives `net_value_amount` and
   * `net_value_currency`. A nested group chains the prefix: `billing_geo_lat`.
   */
  public column<TName extends string>(name: TName): ColumnGroupDefinition<TName, TColumns, false> {
    return new ColumnGroupDefinition(name, this);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEmbeddedObjectDefinition = EmbeddedObjectDefinition<any>;

/**
 * An embedded object placed in a table: its own copies of the object's members, named with the
 * group's prefix. A table's `columns` may hold one wherever it holds a column.
 *
 * A group has no nullability of its own. Each member keeps its own `.notNull()` as its column's
 * `NOT NULL`; a group whose members are all nullable can be absent, which it is when all of
 * them are `NULL`.
 */
export class ColumnGroupDefinition<
  TName extends string,
  TColumns extends TableColumnDefinitions,
  THasDefault extends boolean = false,
> extends DefinitionNode<TName, ColumnGroupConfig<TColumns, THasDefault>> {
  readonly kind = Kind.COLUMN_GROUP;

  readonly object: EmbeddedObjectDefinition<TColumns>;
  readonly columns: Readonly<TColumns>;

  protected _default?: GroupDefaultOf<TColumns>;

  constructor(name: TName, object: EmbeddedObjectDefinition<TColumns>) {
    super(name);

    this.object = object;

    const columns: Record<string, AnyTableColumnDefinition> = {};

    for (const [field, member] of Object.entries<AnyTableColumnDefinition>(object.columns)) {
      columns[field] =
        member instanceof ColumnGroupDefinition
          ? member._renamed(`${name}_${member.name}`)
          : member._renamed(`${name}_${member.name}`, name);
    }

    this.columns = Object.freeze(columns) as Readonly<TColumns>;
  }

  /**
   * Defaults for the group's members — `address.column("billing").default({ city: "-" })` is
   * `.default("-")` on `billing_city`. Members not named keep their own default, if any.
   */
  public default(
    value: GroupDefaultOf<TColumns>
  ): HasDefault<ColumnGroupDefinition<TName, TColumns, true>> {
    for (const [field, memberValue] of Object.entries(value)) {
      const member = (this.columns as TableColumnDefinitions)[field];

      if (!member) {
        throw new Error(`Group "${this.name}" has no member "${field}" to default.`);
      }

      if (memberValue === undefined) {
        continue;
      }

      if (member instanceof ColumnGroupDefinition) {
        member.default(memberValue as GroupDefaultOf<TableColumnDefinitions>);
      } else {
        member.default(memberValue);
      }
    }

    this._default = { ...this._default, ...value };

    return this as unknown as HasDefault<ColumnGroupDefinition<TName, TColumns, true>>;
  }

  /**
   * A copy of this group under another name, defaults included — a group nested in an
   * embedded object, placed in a table under its parent's prefix.
   *
   * @internal
   */
  public _renamed(name: string): this {
    const copy = new ColumnGroupDefinition(name, this.object);

    if (this._default) {
      copy.default(this._default);
    }

    return copy as unknown as this;
  }

  /** @internal */
  _getColumnRefs(): ColumnRefs<TColumns> {
    return Object.fromEntries(
      Object.entries<AnyTableColumnDefinition>(this.columns).map(([field, member]) => [
        field,
        member instanceof ColumnGroupDefinition ? member._getColumnRefs() : new NodeRef(member),
      ])
    ) as ColumnRefs<TColumns>;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      columns: columnEntries(this.columns).map(([, column]) => column.toJSON()),
    };
  }
}

/**
 * Every real column under `columns`, groups walked depth first, each with its field path —
 * `["netValue", "amount"]`. What reaches the database: DDL, the duplicate-name check, tenant
 * claims.
 */
export function columnEntries(
  columns: Readonly<TableColumnDefinitions>,
  path: string[] = []
): [path: string[], column: AnyColumnDefinition][] {
  return Object.entries(columns).flatMap(([field, member]) =>
    member instanceof ColumnGroupDefinition
      ? columnEntries(member.columns, [...path, field])
      : [[[...path, field], member as AnyColumnDefinition]]
  );
}
