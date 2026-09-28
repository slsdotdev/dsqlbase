import { AnyTable, AnySchema, DefinitionSchema, RuntimeTables, Schema } from "@dsqlbase/core";
import { TableByAlias } from "@dsqlbase/core/runtime";
import { UnionToIntersection } from "@dsqlbase/core/utils";
import { ModelClient } from "../model/client.js";
import { ColumnTypeOf, TenantKeysOf, UnionMembersOf, ValueTypeOf } from "../model/base.js";
import { UnionClient } from "../union/client.js";
import { DatabaseClient } from "./client.js";

/** Every union alias in a schema. */
export type UnionAliases<T extends DefinitionSchema> = keyof Schema<T>["unions"] & string;

/**
 * Every alias in a schema the client addresses a model by: each table, and each union.
 */
export type Aliases<T extends DefinitionSchema> = keyof RuntimeTables<Schema<T>> | UnionAliases<T>;

/**
 * The claims a schema declares, as one object.
 *
 * Gathered across tables rather than per table, because that is how an identity is given: one
 * object for the whole client. A claim declared twice with different value types collapses to
 * `never` here, mirroring the registry's data-type check at runtime.
 */
export type ClaimsOf<TSchema extends AnySchema> = UnionToIntersection<
  {
    [A in keyof RuntimeTables<TSchema> & string]: {
      [C in TenantKeysOf<TableByAlias<TSchema, A>>]: ValueTypeOf<
        ColumnTypeOf<TableByAlias<TSchema, A>, C>
      >;
    };
  }[keyof RuntimeTables<TSchema> & string]
>;

/**
 * The aliases a client holding `TClaims` may address: every global table, plus every tenant
 * table whose claims the identity carries in full. A table needing a claim that is not there is
 * not hidden to be tidy — it is hidden because reaching it would throw.
 */
export type VisibleAliases<TSchema extends AnySchema, TClaims> =
  | VisibleTableAliases<TSchema, TClaims>
  | VisibleUnionAliases<TSchema, TClaims>;

type VisibleTableAliases<TSchema extends AnySchema, TClaims> = {
  [A in keyof RuntimeTables<TSchema> & string]: [
    TenantKeysOf<TableByAlias<TSchema, A>>,
  ] extends [keyof TClaims]
    ? A
    : never;
}[keyof RuntimeTables<TSchema> & string];

/**
 * A union is visible only when every member is: each read runs a branch per member, and one
 * branch a client cannot reach makes the whole read throw.
 */
type VisibleUnionAliases<TSchema extends AnySchema, TClaims> = {
  [U in keyof TSchema["unions"] & string]: [
    Exclude<keyof UnionMembersOf<TSchema["unions"][U]>, VisibleTableAliases<TSchema, TClaims>>,
  ] extends [never]
    ? U
    : never;
}[keyof TSchema["unions"] & string];

/**
 * Which aliases a client shows, given its claims and whether it enforces.
 *
 * An unscoped client sees everything when enforcement is off, and only the global tables when
 * it is on — the same rule the runtime applies, so the type never promises a table that would
 * throw.
 */
export type VisibleFor<
  T extends DefinitionSchema,
  TClaims,
  TEnforce extends boolean,
> = [TClaims] extends [never]
  ? TEnforce extends false
    ? Aliases<T>
    : VisibleAliases<Schema<T>, object>
  : VisibleAliases<Schema<T>, TClaims>;

export type Models<
  T extends DefinitionSchema,
  TVisible extends Aliases<T> = Aliases<T>,
> = {
  readonly [K in TVisible]: K extends keyof RuntimeTables<Schema<T>>
    ? RuntimeTables<Schema<T>>[K] extends infer TTable
      ? TTable extends AnyTable
        ? ModelClient<TTable, T>
        : never
      : never
    : K extends UnionAliases<T>
      ? UnionClient<UnionMembersOf<Schema<T>["unions"][K]>, T>
      : never;
};

export type QueryClient<
  T extends DefinitionSchema,
  TEnforce extends boolean = true,
> = DatabaseClient<T, never, TEnforce> & Models<T, VisibleFor<T, never, TEnforce>>;

/**
 * A client scoped to an identity. It has no raw-SQL methods: `$query` on a scoped client would
 * look tenant-safe and would not be, so it is removed rather than guarded only at runtime. It
 * cannot be re-scoped either — claims are set in exactly one place.
 */
export type IdentityClient<T extends DefinitionSchema, TClaims> = Omit<
  DatabaseClient<T, TClaims>,
  "$query" | "$execute" | "$identityClaims"
> &
  Models<T, VisibleFor<T, TClaims, true>>;

export { DatabaseClient };
