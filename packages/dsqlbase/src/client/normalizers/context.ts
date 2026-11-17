import { DefinitionSchema, ExecutionContext, ExecutionContextOptions } from "@dsqlbase/core";
import { WhereBuilder } from "./where.js";
import { RequestNormalizer } from "./request.js";
import { PaginationHandler, PaginationOptions } from "./pagination.js";

export type ClientContextOptions<TDefinition extends DefinitionSchema> =
  ExecutionContextOptions<TDefinition> & {
    pagination?: PaginationOptions;
  };

export class ClientContext<
  TDefinition extends DefinitionSchema = DefinitionSchema,
> extends ExecutionContext<TDefinition> {
  readonly normalizer: RequestNormalizer<TDefinition>;
  readonly pagination: PaginationHandler<TDefinition>;
  readonly where: WhereBuilder;

  constructor(options: ClientContextOptions<TDefinition>) {
    super(options);

    this.normalizer = new RequestNormalizer(this);
    this.pagination = new PaginationHandler(this, options.pagination);
    this.where = new WhereBuilder();
  }
}
