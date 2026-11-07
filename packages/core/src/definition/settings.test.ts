import { describe, expect, it } from "vitest";
import { ColumnDefinition } from "./column.js";
import { SettingDefinition, defineSettings } from "./settings.js";
import { sql } from "../sql/index.js";

describe("defineSettings", () => {
  const params = defineSettings({
    userId: new ColumnDefinition("identity.user_id"),
    level: new ColumnDefinition("identity.level", {
      codec: { encode: (value) => `L${String(value)}`, decode: (raw) => raw },
    }),
  });

  it("names each setting by its key, and its native key by the column name", () => {
    expect(params.userId).toBeInstanceOf(SettingDefinition);
    expect(params.userId.name).toBe("userId");
    expect(params.userId.key).toBe("identity.user_id");
    expect(Object.isFrozen(params)).toBe(true);
  });

  it("encodes a value through its column's codec", () => {
    const query = sql`${params.level}`.toQuery({ settings: { level: 3 } });

    expect(query.params).toEqual(["L3"]);
  });

  it("leaves an unset value NULL, without running the codec", () => {
    expect(sql`${params.level}`.toQuery().params).toEqual([null]);
  });
});
