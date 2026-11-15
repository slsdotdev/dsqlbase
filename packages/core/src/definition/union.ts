import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyTableDefinition } from "./table.js";

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

export type UnionConfig<
  TMembers extends AnyUnionMembers,
  TColumns extends UnionColumnsConfig<TMembers>,
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
  TName extends string,
  TMembers extends AnyUnionMembers,
  TColumns extends UnionColumnsConfig<TMembers>,
> extends DefinitionNode<TName, UnionConfig<TMembers, TColumns>> {
  readonly kind = Kind.UNION;

  readonly members: Readonly<TMembers>;
  readonly columns: Readonly<TColumns>;

  constructor(name: TName, config: UnionConfig<TMembers, TColumns>) {
    super(name);

    this.members = Object.freeze({ ...config.members });
    this.columns = Object.freeze({ ...config.columns });
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
export type AnyUnionDefinition = UnionDefinition<any, any, any>;
