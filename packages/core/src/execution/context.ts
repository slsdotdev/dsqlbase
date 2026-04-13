import { QueryDialect } from "./dialect.js";
import { OperationFactory } from "./operation.js";
import { SchemaRegistry } from "./schema.js";
import { Session } from "../driver/session.js";
import { DefinitionNode } from "../definition/base.js";
import { Schema } from "./types.js";

export interface ExecutionContextOptions<
  TSchema extends Record<string, DefinitionNode> = Record<string, DefinitionNode>,
> {
  session: Session;
  dialect: QueryDialect;
  schema: SchemaRegistry<TSchema>;
}

export class ExecutionContext<
  TSchema extends Record<string, DefinitionNode> = Record<string, DefinitionNode>,
> {
  readonly dialect: QueryDialect;
  readonly operations: OperationFactory<Schema<TSchema>>;
  readonly schema: SchemaRegistry<TSchema>;
  readonly session: Session;

  constructor(options: ExecutionContextOptions<TSchema>) {
    this.session = options.session;
    this.dialect = options.dialect;
    this.schema = options.schema;
    this.operations = new OperationFactory<Schema<TSchema>>(this);
  }
}
