import { AnyUnionDefinition } from "../definition/index.js";
import { AnyColumn } from "./column.js";
import { AnyTable } from "./table.js";

/**
 * The runtime form of a `union()`: its members as built tables, keyed by schema alias, and
 * each shared field resolved to the real column on every member.
 *
 * Built by the registry once every table exists, since a member is only a `Table` from then.
 */
export class Union {
  /** The schema key the union was exported under. */
  readonly alias: string;

  readonly definition: AnyUnionDefinition;

  readonly members: Readonly<Record<string, AnyTable>>;

  /** Shared field → member alias → that member's column for the field. */
  readonly sharedColumns: Readonly<Record<string, Readonly<Record<string, AnyColumn>>>>;

  constructor(definition: AnyUnionDefinition, members: Record<string, AnyTable>, alias: string) {
    this.alias = alias;
    this.definition = definition;
    this.members = Object.freeze({ ...members });

    const shared: Record<string, Record<string, AnyColumn>> = {};

    for (const field of Object.keys(definition.columns)) {
      shared[field] = Object.freeze(
        Object.fromEntries(
          Object.entries(this.members).map(([key, member]) => [
            key,
            member.getColumn(field) as AnyColumn,
          ])
        )
      );
    }

    this.sharedColumns = Object.freeze(shared);
  }

  /** The member aliases, in declaration order. */
  public get memberAliases(): string[] {
    return Object.keys(this.members);
  }

  public hasMember(alias: string): boolean {
    return Object.hasOwn(this.members, alias);
  }

  public getMember(alias: string): AnyTable {
    const member = this.members[alias];

    if (!member) {
      throw new Error(`Union "${this.alias}" has no member "${alias}".`);
    }

    return member;
  }

  public isShared(field: string): boolean {
    return Object.hasOwn(this.sharedColumns, field);
  }

  /** The column a shared field resolves to on one member. */
  public getMemberColumn(alias: string, field: string): AnyColumn {
    const column = this.sharedColumns[field]?.[alias];

    if (!column) {
      throw new Error(
        `Field "${field}" is not shared by every member of union "${this.alias}", so it cannot ` +
          `be used across the union.`
      );
    }

    return column;
  }
}

export type AnyUnion = Union;
