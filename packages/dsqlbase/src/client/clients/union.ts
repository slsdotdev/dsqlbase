import {
  AnyUnion,
  DefinitionSchema,
  ExecutableQuery,
  ExecutionContext,
  Schema,
} from "@dsqlbase/core";
import { TypedObject } from "@dsqlbase/core/utils";
import { RequestNormalizer } from "../normalizers/request.js";
import { CountArgs, UnionQueryArgs, UnionQueryResultOf } from "../normalizers/base.js";

export class UnionClient<
  TUnion extends AnyUnion,
  TDefinition extends DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext<TDefinition>;
  private readonly _union: TUnion;
  private readonly _normalizer: RequestNormalizer<TDefinition>;

  constructor(ctx: ExecutionContext<TDefinition>, union: TUnion) {
    this._ctx = ctx;
    this._union = union;
    this._normalizer = new RequestNormalizer<TDefinition>(ctx);
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
    const request = this._normalizer.createUnionSelectRequest(this._union, args, "one");

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
    const request = this._normalizer.createUnionSelectRequest(this._union, args ?? {}, "many");

    return new ExecutableQuery(
      this._ctx.operations.createUnionSelectOperation(this._union, request),
      this._ctx.session
    );
  }

  /** Counts the rows `where` selects, across every member. */
  public count(args?: CountArgs<TUnion>): ExecutableQuery<number> {
    const request = this._normalizer.createUnionCountRequest(this._union, args);

    return new ExecutableQuery(
      this._ctx.operations.createUnionCountOperation(this._union, request),
      this._ctx.session
    );
  }
}
