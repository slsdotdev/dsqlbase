import { describe, expect, it } from "vitest";
import { DsqlClient } from "./dsql.js";
import { context } from "../../../mocks/context.js";
import { ExecutableQuery } from "@dsqlbase/core";
import { encodeGlobalId } from "../../schema/utils/global-id.js";

const dsql = new DsqlClient(context);

describe("DsqlClient", () => {
  it("should find by global ID", () => {
    const guid = encodeGlobalId("users", { id: "1" });
    const result = dsql.$findByGlobalId(guid);

    expect(result).toBeInstanceOf(ExecutableQuery);
  });
});
