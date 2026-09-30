import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyTableDefinition, TableDefinition } from "./table.js";

export type AnyUnionMembers = Record<string, AnyTableDefinition>;

type MemberColumnsOf<TMembers extends AnyUnionMembers> = {
  [A in keyof TMembers]: TMembers[A]["__type"]["columns"];
}[keyof TMembers];

type MemberValueOf<TColumn> = TColumn extends { __type: { valueType: infer V } } ? V : never;

type ValueUnionOf<TMembers extends AnyUnionMembers, K extends PropertyKey> = {
  [A in keyof TMembers]: MemberValueOf<TMembers[A]["__type"]["columns"][K]>;
}[keyof TMembers];

/**
 * The fields every member of a union declares with the same value type.
 *
 * `keyof` over a union of column maps is already the intersection of their keys; a key then
 * survives only when no member's value type is narrower than the union of all of them. The
 * database type cannot be compared here — `dataType` is a runtime string on every column — so
 * the registry repeats the check against it when the client is built.
 */
export type SharedFieldsOf<TMembers extends AnyUnionMembers> = {
  [K in keyof MemberColumnsOf<TMembers> & string]: {
    [A in keyof TMembers]: [ValueUnionOf<TMembers, K>] extends [
      MemberValueOf<TMembers[A]["__type"]["columns"][K]>,
    ]
      ? never
      : A;
  }[keyof TMembers] extends never
    ? K
    : never;
}[keyof MemberColumnsOf<TMembers> & string];

/**
 * A field every member of a union shares, addressed on the union rather than on one member —
 * `posts.columns.userId` in `hasMany(posts, { to: [posts.columns.userId] })`.
 *
 * It names a field, not a database column: members may store the same field under different
 * column names, so `name` is the field alias and `members` holds the real column per member.
 * Typed as the first member's column, which is what every member agrees on.
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

export type UnionColumns<TMembers extends AnyUnionMembers> = {
  readonly [K in SharedFieldsOf<TMembers>]: UnionColumnDefinition<
    K,
    TMembers[keyof TMembers]["__type"]["columns"][K]
  >;
};

export type UnionConfig<TMembers extends AnyUnionMembers> = {
  members: TMembers;
};

/**
 * A set of tables that can stand in for one another — a GraphQL union or interface.
 *
 * Each member is keyed by its schema alias, which the registry checks when the client is
 * built, because only there are aliases known. A union is not a table and produces no DDL:
 * relations target it, and the client reads it as one `UNION ALL` over its members.
 */
export class UnionDefinition<
  TMembers extends AnyUnionMembers = AnyUnionMembers,
> extends DefinitionNode<string, UnionConfig<TMembers>> {
  readonly kind = Kind.UNION;

  readonly members: Readonly<TMembers>;

  /** The shared fields — see {@link SharedFieldsOf}. */
  readonly columns: UnionColumns<TMembers>;

  constructor(members: TMembers) {
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
    this.columns = this._buildColumns() as UnionColumns<TMembers>;
  }

  /**
   * The fields present on every member with the same `dataType`. A field whose type differs
   * on one member is dropped rather than refused: it is still usable per member through `on`,
   * just not across the union.
   */
  private _buildColumns(): Record<string, AnyUnionColumnDefinition> {
    const [first, ...rest] = Object.entries(this.members);
    const columns: Record<string, AnyUnionColumnDefinition> = {};

    for (const [field, column] of Object.entries<AnyColumnDefinition>(first[1].columns)) {
      const members: Record<string, AnyColumnDefinition> = { [first[0]]: column };
      let shared = true;

      for (const [alias, member] of rest) {
        const candidate = (member.columns as Record<string, AnyColumnDefinition>)[field];

        if (!candidate || candidate["_dataType"] !== column["_dataType"]) {
          shared = false;
          break;
        }

        members[alias] = candidate;
      }

      if (shared) {
        columns[field] = new UnionColumnDefinition(field, members);
      }
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
export type AnyUnionDefinition = UnionDefinition<any>;
