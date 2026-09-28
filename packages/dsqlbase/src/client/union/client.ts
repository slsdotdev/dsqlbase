import { DefinitionSchema } from "@dsqlbase/core";
import { AnyUnionMembers } from "@dsqlbase/core/definition";
import {
  CompositeQuery,
  Executable,
  ExecutableQuery,
  ExecutionContext,
  Schema,
  Union,
} from "@dsqlbase/core/runtime";
import { TypedObject } from "@dsqlbase/core/utils";
import {
  AnyUnionQuery,
  UnionCountArgs,
  UnionFindOneArgs,
  UnionPageOf,
  UnionPaginateArgs,
  UnionQueryArgs,
  UnionResultOf,
} from "../model/base.js";
import { RequestNormalizer } from "../model/normalizer.js";
import { shapePage } from "../pagination/page.js";

/**
 * Reads a `union()` as one set of rows: `dsql.<unionAlias>.findMany(...)` and friends. Read-only —
 * a row is written through its member's own model.
 *
 * Every read is one `UNION ALL` over the members, each branch passing the same `WHERE` seam a
 * table read does, so a tenant-scoped member is filtered, or refused, on its own terms.
 */
export class UnionClient<
  TMembers extends AnyUnionMembers,
  TDefinition extends DefinitionSchema,
> implements TypedObject<Schema<TDefinition>> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext<TDefinition>;
  private readonly _union: Union;
  private readonly _normalizer: RequestNormalizer<TDefinition>;

  constructor(ctx: ExecutionContext<TDefinition>, union: Union) {
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
  public findOne<TArgs extends UnionFindOneArgs<TMembers, this["__type"]>>(
    args: TArgs
  ): ExecutableQuery<UnionResultOf<TMembers, this["__type"], TArgs> | null> {
    const request = this._normalizer.normalizeUnionSelect(
      this._union,
      args as AnyUnionQuery,
      "one"
    );

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
   *   where: { userId: { eq: userId }, $$key: { in: types } },
   *   orderBy: { createdAt: "desc" },
   *   limit: 20,
   *   on: { photos: { select: { photoUrl: true } } },
   * });
   * ```
   */
  public findMany<TArgs extends UnionQueryArgs<TMembers, this["__type"]>>(
    args?: TArgs
  ): ExecutableQuery<UnionResultOf<TMembers, this["__type"], TArgs>[]> {
    const request = this._normalizer.normalizeUnionSelect(
      this._union,
      (args ?? {}) as AnyUnionQuery,
      "many"
    );

    return new ExecutableQuery(
      this._ctx.operations.createUnionSelectOperation(this._union, request),
      this._ctx.session
    );
  }

  /**
   * One page across every member, ordered by `orderBy`, then `$$key`, then the primary key —
   * with a cursor on each record to continue from. The same cursors as a table's, signed
   * against the union.
   *
   * @throws {InvalidCursorError} when `after` or `before` is not a cursor for this order.
   */
  public paginate<TArgs extends UnionPaginateArgs<TMembers, this["__type"]>>(
    args: TArgs
  ): Executable<UnionPageOf<TMembers, this["__type"], TArgs>> {
    const plan = this._normalizer.normalizeUnionPaginate(this._union, args as AnyUnionQuery);
    const select = this._ctx.operations.createUnionSelectOperation(this._union, plan.request);

    const page = new ExecutableQuery<UnionPageOf<TMembers, this["__type"], TArgs>>(
      { ...select, resolve: (rows) => shapePage(rows, select.resolve, plan) as never },
      this._ctx.session
    );

    if (!args.count) {
      return page;
    }

    const count = new ExecutableQuery<number>(
      this._ctx.operations.createUnionCountOperation(this._union, plan.count),
      this._ctx.session
    );

    return new CompositeQuery(
      [page, count] as const,
      ([result, totalCount]) =>
        ({ ...result, totalCount }) as UnionPageOf<TMembers, this["__type"], TArgs>
    );
  }

  /** Counts the rows `where` selects, across every member. */
  public count(args?: UnionCountArgs<TMembers>): ExecutableQuery<number> {
    const request = this._normalizer.normalizeUnionCount(this._union, args as AnyUnionQuery);

    return new ExecutableQuery(
      this._ctx.operations.createUnionCountOperation(this._union, request),
      this._ctx.session
    );
  }
}
