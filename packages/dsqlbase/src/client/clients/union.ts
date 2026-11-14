import { AnyUnion, DefinitionSchema, ExecutableQuery, Schema } from "@dsqlbase/core";
import { TypedObject } from "@dsqlbase/core/utils";
import {
  CountArgs,
  PaginatedUnionQueryArgs,
  PaginatedUnionQueryResultOf,
  UnionQueryArgs,
  UnionQueryResultOf,
} from "../normalizers/base.js";
import { ClientContext } from "../normalizers/context.js";

export class UnionClient<
  TUnion extends AnyUnion,
  TDefinition extends DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ClientContext<TDefinition>;
  private readonly _union: TUnion;

  constructor(ctx: ClientContext<TDefinition>, union: TUnion) {
    this._ctx = ctx;
    this._union = union;
  }

  /**
   * Reads the first row, across every member, that `where` selects — in `orderBy` order when
   * one is given.
   *
   * @example
   * ```ts
   * const post = await dsql.posts.findOne({ where: { id: { eq: postId } } });
   * if (post?.$$key === "photos") post.photoUrl;
   * ```
   */
  public findOne<TArgs extends UnionQueryArgs<TUnion, this["__type"]>>(
    args: TArgs
  ): ExecutableQuery<UnionQueryResultOf<TUnion, this["__type"], TArgs> | null> {
    const request = this._ctx.normalizer.createUnionSelectRequest(this._union, args, "one");

    return new ExecutableQuery(
      this._ctx.operations.createUnionSelectOperation(this._union, request),
      this._ctx.session
    );
  }

  /**
   * Reads rows from every member, as one list.
   *
   * @example
   * ```ts
   * const feed = await dsql.posts.findMany({
   *   where: { userId: { eq: userId } },
   *   orderBy: { createdAt: "desc" },
   *   limit: 20,
   *   on: { photos: { select: { photoUrl: true } } },
   * });
   * ```
   */
  public findMany<TArgs extends UnionQueryArgs<TUnion, this["__type"]>>(
    args?: TArgs
  ): ExecutableQuery<UnionQueryResultOf<TUnion, this["__type"], TArgs>[]> {
    const request = this._ctx.normalizer.createUnionSelectRequest(this._union, args ?? {}, "many");
    const operation = this._ctx.operations.createUnionSelectOperation(this._union, request);

    return new ExecutableQuery(operation, this._ctx.session);
  }

  public paginatedQuery<TArgs extends PaginatedUnionQueryArgs<TUnion, this["__type"]>>(
    args: TArgs
  ): ExecutableQuery<PaginatedUnionQueryResultOf<TUnion, this["__type"], TArgs>[]> {
    const request = this._ctx.normalizer.createUnionSelectRequest(this._union, args, "many");
    const withPagination = this._ctx.pagination.paginateUnionRequest(this._union, args, request);
    const operation = this._ctx.operations.createUnionSelectOperation(this._union, request);

    return new ExecutableQuery(withPagination(operation), this._ctx.session);
  }

  /** Counts the rows `where` selects, across every member. */
  public count(args?: CountArgs<TUnion>): ExecutableQuery<number> {
    const request = this._ctx.normalizer.createUnionCountRequest(this._union, args);

    return new ExecutableQuery(
      this._ctx.operations.createUnionCountOperation(this._union, request),
      this._ctx.session
    );
  }
}
