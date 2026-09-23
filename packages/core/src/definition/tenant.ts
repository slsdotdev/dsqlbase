import { Prettify, ReadOnly, TenantKey } from "../utils/index.js";
import { DefinitionNode, Kind } from "./base.js";
import { AnyColumnDefinition } from "./column.js";
import { AnyNamespaceDefinition } from "./namespace.js";
import { TableDefinition } from "./table.js";

/** The name a scope carries when none is given. It names nothing in the database. */
const DEFAULT_SCOPE_NAME = "tenant_scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTenantScopeDefinition = TenantScopeDefinition<any>;

/** The claim columns as a table receives them: system-managed and marked as claim keys. */
export type TenantClaimColumns<TClaims extends Record<string, AnyColumnDefinition>> = {
  [K in keyof TClaims]: TenantKey<ReadOnly<TClaims[K]>>;
};

/** A table's own columns with the scope's claim columns merged in front of them. */
export type WithClaims<
  TClaims extends Record<string, AnyColumnDefinition>,
  TColumns extends Record<string, AnyColumnDefinition>,
> = Prettify<TenantClaimColumns<TClaims> & TColumns>;

export interface TenantScopeConfig<TClaims extends Record<string, AnyColumnDefinition>> {
  claims: TClaims;
}

/**
 * A named set of claim columns shared by every table in one tenant boundary.
 *
 * The scope is the only producer of the `tenantKey` marker: a column carries it by being
 * declared here, never by a builder of its own. That is deliberate — a per-column marker would
 * leave no single place that says "these are the claims", which is what
 * `ExecutionContext.identity` has to be matched against.
 *
 * It is a definition node so it may be exported from a schema module beside the tables that use
 * it; the registry keeps only tables and relations, and it is not a schema object, so no
 * migration ever sees it.
 */
export class TenantScopeDefinition<
  TClaims extends Record<string, AnyColumnDefinition>,
> extends DefinitionNode<string, TenantScopeConfig<TClaims>> {
  readonly kind = Kind.TENANT_SCOPE;

  private readonly _claims: TClaims;

  constructor(claims: TClaims, name: string = DEFAULT_SCOPE_NAME) {
    super(name);

    const fields = Object.keys(claims);

    if (fields.length === 0) {
      throw new Error(`Tenant scope "${name}" declares no claim columns.`);
    }

    for (const field of fields) {
      if (!claims[field]["_notNull"]) {
        throw new Error(
          `Claim "${field}" on tenant scope "${name}" must be notNull. ` +
            `A claim column is filled by the runtime on every insert, so it is never null.`
        );
      }
    }

    this._claims = claims;
  }

  /** The claim field names, in declaration order. */
  public get claims(): (keyof TClaims & string)[] {
    return Object.keys(this._claims) as (keyof TClaims & string)[];
  }

  /**
   * A fresh copy of every claim column, marked as a claim key and system-managed.
   *
   * Fresh on every call: the builders mutate a `ColumnDefinition` in place, so handing the same
   * instance to two tables would let a later change on one reach the other.
   */
  public columns(): TenantClaimColumns<TClaims> {
    const columns = {} as Record<string, AnyColumnDefinition>;

    for (const [field, claim] of Object.entries<AnyColumnDefinition>(this._claims)) {
      const column = claim.clone();

      column["_tenantKey"] = true;
      column["_readOnly"] = true;

      columns[field] = column;
    }

    return columns as TenantClaimColumns<TClaims>;
  }

  /**
   * A table inside this scope: sugar for spreading {@link columns} into `table(name, { … })`.
   *
   * Use the spread form directly when the table needs a different constructor — a namespaced
   * table is built by `namespace().table()`, which this cannot stand in for.
   */
  public table<TName extends string, TColumns extends Record<string, AnyColumnDefinition>>(
    name: TName,
    columns: TColumns
  ): TableDefinition<TName, WithClaims<TClaims, TColumns>, AnyNamespaceDefinition> {
    const claims = this.columns() as Record<string, AnyColumnDefinition>;

    for (const field of Object.keys(columns)) {
      if (Object.hasOwn(claims, field)) {
        throw new Error(
          `Table "${name}" redeclares claim "${field}" from tenant scope "${this.name}". ` +
            `A claim column is declared once, on the scope.`
        );
      }
    }

    return new TableDefinition(name, {
      columns: { ...claims, ...columns } as WithClaims<TClaims, TColumns>,
    });
  }
}
