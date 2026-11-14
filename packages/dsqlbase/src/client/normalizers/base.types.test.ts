import { describe, expectTypeOf, it } from "vitest";
import { MockSchema } from "../../../mocks/context.js";
import type { QueryResultOf, UnionQueryResultOf } from "./base.js";
import { TableByAlias, UnionByAlias } from "@dsqlbase/core/runtime/registry";

describe("Base types", () => {
  it("infers union selection result", () => {
    type Result = UnionQueryResultOf<
      UnionByAlias<MockSchema, "media">,
      MockSchema,
      { select: { id: true }; on: { photos: false } }
    >;

    expectTypeOf<Result>().toEqualTypeOf<{ id: string }>();
  });

  it("infers result for paginated query", () => {
    type Result = QueryResultOf<
      TableByAlias<MockSchema, "posts">,
      MockSchema,
      { select: { id: true } }
    >;

    expectTypeOf<Result>().toEqualTypeOf<{ id: string }>();
  });
});
