import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyTableDefinition, TableDefinition } from "./table.js";

export type AnyUnionMembers = Record<string, AnyTableDefinition>;

/**
 * The fields every member of a union declares — `keyof` over a union of column maps is the
 * intersection of their keys. A union's declared columns are drawn from these.
 */
export type CommonFieldsOf<TMembers extends AnyUnionMembers> = keyof {
  [A in keyof TMembers]: TMembers[A]["__type"]["columns"];
}[keyof TMembers] &
  string;

/** What `union()` declares: shared field → the column every member stores it in. */
export type UnionColumnsConfig<TMembers extends AnyUnionMembers> = Partial<
  Record<CommonFieldsOf<TMembers>, AnyColumnDefinition>
>;

/**
 * A field every member of a union shares, addressed on the union rather than on one member —
 * `posts.columns.userId` in `hasMany(posts, { to: [posts.columns.userId] })`.
 *
 * Declared on the union — `union({ photos, videos }, { userId: guid("user_id") })` — and
 * resolved to the member column under the same field, which must agree with the declaration.
 * `name` is the field; `members` holds the real column per member. Typed as the declared column.
 */
export class UnionColumnDefinition<
  TField extends string = string,
  TColumn extends AnyColumnDefinition = AnyColumnDefinition,
> extends DefinitionNode<TField, TColumn["__type"]> {
  readonly kind = Kind.UNION_COLUMN;

  readonly members: Readonly<Record<string, AnyColumnDefinition>>;

  constructor(field: TField, members: Record<string, AnyColumnDefinition>) {
    super(field);

    this.members = Object.freeze({ ...members });
  }
}

export type AnyUnionColumnDefinition = UnionColumnDefinition<string, AnyColumnDefinition>;

export type UnionColumns<TColumns extends Partial<Record<string, AnyColumnDefinition>>> = {
  readonly [K in keyof TColumns & string]: UnionColumnDefinition<K, NonNullable<TColumns[K]>>;
};

export type UnionConfig<
  TMembers extends AnyUnionMembers,
  TColumns extends Partial<Record<string, AnyColumnDefinition>>,
> = {
  members: TMembers;
  columns: TColumns;
};

/**
 * A set of tables that can stand in for one another — a GraphQL union or interface.
 *
 * Each member is keyed by its schema alias, which the registry checks when the client is
 * built, because only there are aliases known. The fields that work across the union — in a
 * relation's `to`, and in shared `select` / `where` / `orderBy` — are the ones it declares. A
 * union is not a table and produces no DDL: relations target it, and the client reads it as one
 * `UNION ALL` over its members.
 */
export class UnionDefinition<
  TMembers extends AnyUnionMembers = AnyUnionMembers,
  TColumns extends Partial<Record<string, AnyColumnDefinition>> = Record<
    string,
    AnyColumnDefinition
  >,
> extends DefinitionNode<string, UnionConfig<TMembers, TColumns>> {
  readonly kind = Kind.UNION;

  readonly members: Readonly<TMembers>;

  /** The declared shared fields, each resolved to every member's column. */
  readonly columns: UnionColumns<TColumns>;

  constructor(members: TMembers, columns: TColumns) {
    const aliases = Object.keys(members);

    // A union has no name of its own until the registry reads the key it is exported under;
    // this one exists for error messages raised before then.
    super(`union(${aliases.join("|")})`);

    if (aliases.length === 0) {
      throw new Error(`A union must have at least one member.`);
    }

    for (const [alias, member] of Object.entries(members)) {
      if (!((member as unknown) instanceof TableDefinition)) {
        throw new Error(
          `Union member "${alias}" is not a table. Members are tables; a union cannot contain ` +
            `another union.`
        );
      }
    }

    this.members = Object.freeze({ ...members });
    this.columns = this._buildColumns(columns) as UnionColumns<TColumns>;
  }

  /**
   * Resolves each declared field to the member column under the same field, which has to be
   * the column the declaration describes: the same database name, data type and column kind
   * (a `guid()` is not a `uuid()`), and `NOT NULL` wherever the declaration is. A shared field
   * is one column in a `UNION ALL`, so anything less would read differently per member.
   */
  private _buildColumns(
    declared: Partial<Record<string, AnyColumnDefinition>>
  ): Record<string, AnyUnionColumnDefinition> {
    const columns: Record<string, AnyUnionColumnDefinition> = {};

    for (const [field, column] of Object.entries(declared)) {
      if (!column) {
        continue;
      }

      const members: Record<string, AnyColumnDefinition> = {};

      for (const [alias, member] of Object.entries(this.members)) {
        const candidate = (member.columns as Record<string, AnyColumnDefinition | undefined>)[
          field
        ];
        const label = `${this.name} declares "${field}", but member "${alias}"`;

        if (!candidate) {
          throw new Error(`${label} has no such field.`);
        }

        if (candidate.name !== column.name) {
          throw new Error(
            `${label} stores it in column "${candidate.name}", not "${column.name}". A shared ` +
              `field has one column name on every member.`
          );
        }

        if (
          candidate["_dataType"] !== column["_dataType"] ||
          Object.getPrototypeOf(candidate) !== Object.getPrototypeOf(column)
        ) {
          throw new Error(
            `${label} declares it as a different kind of column (${candidate["_dataType"]}). ` +
              `A shared field has one type on every member.`
          );
        }

        if (column["_notNull"] && !candidate["_notNull"]) {
          throw new Error(`${label} allows NULL in it, and the union declares it NOT NULL.`);
        }

        members[alias] = candidate;
      }

      columns[field] = new UnionColumnDefinition(field, members);
    }

    return Object.freeze(columns);
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      members: Object.fromEntries(
        Object.entries(this.members).map(([alias, member]) => [alias, member.name])
      ),
    } as const;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyUnionDefinition = UnionDefinition<any, any>;
