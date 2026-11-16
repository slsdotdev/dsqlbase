import { describe, expectTypeOf, it } from "vitest";
import { MockSchema } from "../../../mocks/context.js";
import type { MutationResultOf, QueryResultOf, UnionQueryResultOf } from "./base.js";
import { TableByAlias, UnionByAlias } from "@dsqlbase/core/runtime/registry";

describe("Base types", () => {
  it("infers union selection result", () => {
    type Result = UnionQueryResultOf<
      UnionByAlias<MockSchema, "media">,
      MockSchema,
      { select: { id: true }; on: { photos: false } }
    >;

    expectTypeOf<Result>().toEqualTypeOf<{ id: string; __type: "videos" }>();
  });

  it("infers result for paginated query", () => {
    type Result = QueryResultOf<
      TableByAlias<MockSchema, "users">,
      MockSchema,
      { select: { id: true } }
    >;

    expectTypeOf<Result>().toEqualTypeOf<{ id: string }>();
  });

  it("infers mutation result", () => {
    type Result = MutationResultOf<
      TableByAlias<MockSchema, "users">,
      {
        set: { name: "Test" };
        where: { id: "1" };
        return: { id: true };
      }
    >;

    expectTypeOf<Result>().toEqualTypeOf<{ id: string }>();
  });

  it("infers on joins", () => {
    type Result = QueryResultOf<
      TableByAlias<MockSchema, "users">,
      MockSchema,
      {
        select: { id: true };
        join: {
          feed: {
            select: { id: true };
            on: { videos: { join: { posts: { select: { id: true } } } } };
          };
        };
      }
    >;

    expectTypeOf<Result>().toEqualTypeOf<{
      id: string;
      feed: (
        | {
            id: string;
            __type: "photos";
          }
        | { __type: "videos"; id: string; posts: { id: string }[] }
      )[];
    }>();
  });
});
