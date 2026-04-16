import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core/definition";
import { DateTimeMode, safeParseDate } from "../../utils/date.js";
import { DateValueType } from "./date.js";

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
   * @default false
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
  const dataType = options?.tz ? "timestamp with time zone" : "timestamp";

  return new ColumnDefinition<TName, ColumnConfig<DateValueType<TOptions>, string>>(name, {
    dataType,
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
