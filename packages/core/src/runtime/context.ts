import { TypedObject } from "../utils/index.js";
import { DefinitionSchema } from "../definition/index.js";
import { QueryBuilder } from "./query.js";
import { Schema } from "./base.js";
import { Session } from "./session.js";
import { SchemaRegistry } from "./registry.js";
import { OperationsFactory } from "./operation.js";

export interface ExecutionContextOptions<TSchema extends DefinitionSchema> {
  session: Session;
  dialect: QueryBuilder;
  schema: SchemaRegistry<TSchema>;
}

export class ExecutionContext<
  TDefinition extends DefinitionSchema = DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  readonly session: Session;
  readonly dialect: QueryBuilder;
  readonly schema: SchemaRegistry<TDefinition>;
  readonly operations: OperationsFactory<Schema<TDefinition>>;

  constructor(options: ExecutionContextOptions<TDefinition>) {
    this.session = options.session;
    this.dialect = options.dialect;
    this.schema = options.schema;
    this.operations = new OperationsFactory<Schema<TDefinition>>(this);
  }
}
