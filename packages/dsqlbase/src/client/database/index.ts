import { AnyTable, AnySchema, DefinitionSchema, RuntimeTables, Schema } from "@dsqlbase/core";
import { TableByAlias } from "@dsqlbase/core/runtime";
import { UnionToIntersection } from "@dsqlbase/core/utils";
import { ModelClient } from "../model/client.js";
import { ColumnTypeOf, TenantKeysOf, ValueTypeOf } from "../model/base.js";
import { DatabaseClient } from "./client.js";

/** Every table alias in a schema — the names the client addresses its models by. */
export type Aliases<T extends DefinitionSchema> = keyof RuntimeTables<Schema<T>>;

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
export type VisibleAliases<TSchema extends AnySchema, TClaims> = {
  [A in keyof RuntimeTables<TSchema> & string]: [
    TenantKeysOf<TableByAlias<TSchema, A>>,
  ] extends [keyof TClaims]
    ? A
    : never;
}[keyof RuntimeTables<TSchema> & string];

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
  readonly [K in TVisible]: RuntimeTables<Schema<T>>[K] extends infer TTable
    ? TTable extends AnyTable
      ? ModelClient<TTable, T>
      : never
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
