import { describe, expect, it } from "vitest";
import { ColumnDefinition } from "./column.js";
import { SettingDefinition, SettingsDefinition } from "./settings.js";
import { sql } from "../sql/index.js";

describe("SettingsDefinition", () => {
  const params = new SettingsDefinition({
    userId: new ColumnDefinition("identity.user_id"),
    level: new ColumnDefinition("identity.level", {
      codec: { encode: (value) => `L${String(value)}`, decode: (raw) => raw },
    }),
  });

  it("names each setting by its key, and its native key by the column name", () => {
    expect(params.settings.userId).toBeInstanceOf(SettingDefinition);
    expect(params.settings.userId.name).toBe("userId");
    expect(params.settings.userId.key).toBe("identity.user_id");
    expect(Object.isFrozen(params.settings)).toBe(true);
  });

  it("encodes a value through its column's codec", () => {
    const query = sql`${params.settings.level}`.toQuery({ settings: { level: 3 } });

    expect(query.params).toEqual(["L3"]);
  });

  it("leaves an unset value NULL, without running the codec", () => {
    expect(sql`${params.settings.level}`.toQuery().params).toEqual([null]);
  });
});
