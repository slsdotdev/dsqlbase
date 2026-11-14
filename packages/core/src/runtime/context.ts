import { TypedObject } from "../utils/index.js";
import { DefinitionSchema } from "../definition/index.js";
import { QueryBuilder } from "./query.js";
import { Schema } from "./base.js";
import { Session } from "./session.js";
import { SchemaRegistry } from "./registry.js";
import { OperationsFactory } from "./operation.js";

export type ExecutionContextOptions<TSchema extends DefinitionSchema> = {
  session: Session;
  dialect: QueryBuilder;
  schema: SchemaRegistry<TSchema>;

  /**
   * The values settings render from, keyed by setting name. Absent on a base client; set by
   * `$settings`, merged over the parent's. It derives a new context rather than mutating this
   * one, so concurrent requests never see each other's values, and a query's SQL is fixed by the
   * client that built it. An unset setting renders `NULL`.
   */
  settings?: Readonly<Record<string, unknown>>;

  /**
   * `bypass: true` skips every row policy — predicates and checks — on this context and every
   * one derived from it: the `BYPASSRLS` analogue, for a worker rather than a request handler.
   * Set per client, never per call. Settings still render.
   */
  policies?: { bypass?: boolean };
};

export class ExecutionContext<
  TDefinition extends DefinitionSchema = DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  readonly session: Session;
  readonly dialect: QueryBuilder;
  readonly schema: SchemaRegistry<TDefinition>;
  readonly operations: OperationsFactory<Schema<TDefinition>>;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly policies: { readonly bypass: boolean };

  constructor(options: ExecutionContextOptions<TDefinition>) {
    this.session = options.session;
    this.dialect = options.dialect;
    this.schema = options.schema;
    this.settings = options.settings;
    this.policies = Object.freeze({ bypass: options.policies?.bypass ?? false });
    this.operations = new OperationsFactory<Schema<TDefinition>>(this);
  }
}
