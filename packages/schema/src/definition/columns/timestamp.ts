import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core/definition";
import { DateTimeMode, safeParseDate } from "../../utils/date.js";
import { DateValueType } from "./date.js";
import { HasDefault } from "@dsqlbase/core/utils";
import { sql } from "@dsqlbase/core";

export interface TimestampColumnConfig<
  TValueType = unknown,
  TRawType = unknown,
> extends ColumnConfig<TValueType, TRawType> {
  withTimezone?: boolean;
}

export class TimestampColumnDefinition<
  TName extends string,
  TConfig extends TimestampColumnConfig,
> extends ColumnDefinition<TName, TConfig> {
  private _withTimezone: boolean;

  constructor(name: TName, config: Partial<TConfig> = {}) {
    super(name, config);

    this._withTimezone = config.withTimezone ?? false;
  }

  public defaultNow(): HasDefault<this> {
    this._defaultValue = this._withTimezone
      ? sql.raw("current_timestamp")
      : sql.raw("localtimestamp");

    return this as HasDefault<this>;
  }
}

export interface DateTimeColumnOptions {
  /**
   * Determines how the datetime is parsed and formatted, at runtime:
   * - `"iso"`: The column will handle datetime values as ISO 8601 strings (e.g., 'YYYY-MM-DDTHH:mm:ss.sssZ').
   * - `"string"`: The column will handle datetime values as human-readable strings (e.g., 'Wed Sep 15 2021 14:48:00 GMT+0000 (Coordinated Universal Time)').
   * - `"date"`: The column will handle datetime values as JavaScript Date objects.
   *
   * @default "date"
   */
  mode?: DateTimeMode;

  /**
   * Whether to include timezone information when encoding/decoding datetime values:
   * - `true`: Column is defined as `timestamp with time zone` and will handle datetime values with timezone information (e.g., 'YYYY-MM-DDTHH:mm:ssZ' or 'YYYY-MM-DDTHH:mm:ss+00:00').
   * - `false`: Column is defined as `timestamp without time zone` and will handle datetime values without timezone information (e.g., 'YYYY-MM-DDTHH:mm:ss').
   * @default true
   */
  tz?: boolean;
}

/**
 * Defines a `timestamp` type column in the database schema.
 *
 * @param name Column name
 * @param options Optional configuration for datetime parsing and formatting
 * @returns Serializable column definition for a datetime column.
 */

export function timestamp<const TName extends string, const TOptions extends DateTimeColumnOptions>(
  name: TName,
  options?: TOptions
) {
  const withTimezone = options?.tz ?? true;
  const dataType = withTimezone ? "timestamp with time zone" : "timestamp";

  return new TimestampColumnDefinition<
    TName,
    TimestampColumnConfig<DateValueType<TOptions>, string>
  >(name, {
    dataType,
    withTimezone,
    codec: {
      encode: (value) => {
        const date = safeParseDate(value);

        if (options?.mode === "iso") {
          return date.toISOString(); // Format as ISO 8601 string
        }

        return date.toString();
      },
      decode: (value) => {
        const date = safeParseDate(value);

        switch (options?.mode) {
          case "iso":
            return date.toISOString() as DateValueType<TOptions>;
          case "string":
            return date.toString() as DateValueType<TOptions>;
          case "date":
          default:
            return date as DateValueType<TOptions>;
        }
      },
    },
  });
}

export { timestamp as datetime };
