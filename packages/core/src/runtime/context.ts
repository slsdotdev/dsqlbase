import { TypedObject } from "../utils/index.js";
import { DefinitionSchema } from "../definition/index.js";
import { QueryBuilder } from "./query.js";
import { Schema } from "./base.js";
import { Session } from "./session.js";
import { SchemaRegistry } from "./registry.js";
import { OperationsFactory } from "./operation.js";

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
  readonly pagination?: PaginationOptions;

  constructor(options: ExecutionContextOptions<TDefinition>) {
    this.session = options.session;
    this.dialect = options.dialect;
    this.schema = options.schema;
    this.pagination = options.pagination;
    this.operations = new OperationsFactory<Schema<TDefinition>>(this);
  }
}
