import { QueryDialect } from "./dialect.js";
import { OperationFactory } from "./operation.js";
import { SchemaRegistry } from "./schema.js";
import { Session } from "../driver/session.js";

export interface ExecutionContextOptions {
  session: Session;
  dialect: QueryDialect;
  schema: SchemaRegistry;
}

export class ExecutionContext {
  readonly dialect: QueryDialect;
  readonly operations: OperationFactory;
  readonly schema: SchemaRegistry;
  readonly session: Session;

  constructor(options: ExecutionContextOptions) {
    this.session = options.session;
    this.dialect = options.dialect;
    this.schema = options.schema;
    this.operations = new OperationFactory(this);
  }
}
