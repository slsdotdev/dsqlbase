import { ColumnConfig, ColumnDefinition, sql } from "@dsqlbase/core";
import { HasDefault } from "@dsqlbase/core/utils";

export class UUIDColumnDefinition<
  TName extends string,
  TConfig extends ColumnConfig,
> extends ColumnDefinition<TName, TConfig> {
  /**
   * Sets `gen_random_uuid()` as the default value for this UUID column, at database level.
   * @returns *`this`*
   */
  public defaultRandom(): HasDefault<this> {
    this._defaultValue = sql.raw("gen_random_uuid()");
    return this as HasDefault<this>;
  }
}

/**
 * Defines a `UUID` data type column in the database schema.
 *
 * @param name Name of the column in database
 * @returns Serializable column definition for a UUID column.
 */

export function uuid<TName extends string>(name: TName) {
  return new UUIDColumnDefinition<TName, ColumnConfig<string, string>>(name, {
    dataType: "UUID",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}
