import { TypedObject } from "../utils/index.js";
import { DefinitionSchema } from "../definition/index.js";
import { QueryBuilder } from "./query.js";
import { Schema } from "./base.js";
import { Session } from "./session.js";
import { SchemaRegistry } from "./registry.js";
import { OperationsFactory } from "./operation.js";

/** How a tenant table behaves on a client that carries no identity. */
export type TenancyOptions = {
  /**
   * Refuse to build an operation on a tenant table when there are no claims to scope it with.
   * On by default: a query that silently runs unscoped is the bug this exists to prevent.
   */
  enforce?: boolean;
};

/** Page-size bounds for keyset pagination. Carried here for the client; core reads neither. */
export type PaginationOptions = {
  /** The page size when a call names none. */
  defaultLimit?: number;
  /** The largest page size a call may ask for. Unbounded when absent. */
  maxLimit?: number;
};

export type ExecutionContextOptions<TSchema extends DefinitionSchema> = {
  session: Session;
  dialect: QueryBuilder;
  schema: SchemaRegistry<TSchema>;

  /**
   * The claims every tenant table on this context is scoped to, keyed by claim name.
   *
   * Absent on a base client and set once by `$identityClaims`, which builds a derived context
   * rather than mutating this one — the reason a scoped and an unscoped client can coexist in
   * one process, and why a query's SQL is fixed by the client that built it.
   */
  identity?: Record<string, unknown>;

  tenancy?: TenancyOptions;

  pagination?: PaginationOptions;
};

export class ExecutionContext<
  TDefinition extends DefinitionSchema = DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  readonly session: Session;
  readonly dialect: QueryBuilder;
  readonly schema: SchemaRegistry<TDefinition>;
  readonly operations: OperationsFactory<Schema<TDefinition>>;
  readonly identity?: Record<string, unknown>;
  readonly tenancy: Required<TenancyOptions>;
  readonly pagination?: PaginationOptions;

  constructor(options: ExecutionContextOptions<TDefinition>) {
    this.session = options.session;
    this.dialect = options.dialect;
    this.schema = options.schema;
    this.identity = options.identity;
    this.tenancy = { enforce: options.tenancy?.enforce ?? true };
    this.pagination = options.pagination;
    this.operations = new OperationsFactory<Schema<TDefinition>>(this);
  }
}
