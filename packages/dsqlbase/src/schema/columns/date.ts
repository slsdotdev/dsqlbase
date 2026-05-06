import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core/definition";
import { DateTimeMode, formatDate, safeParseDate } from "../utils/date.js";

export interface DateColumnOptions {
  /**
   * Determines how the date is parsed and formatted, at runtime:
   * - `"date"`: The column will handle JavaScript Date objects and store them in 'YYYY-MM-DD' format.
   * - `"iso"`: The column will handle ISO 8601 date strings directly, without converting them to Date objects.
   * - `"string"`: Same as `"iso"`, but explicitly indicates that the value is a string.
   *
   * @default "date"
   */
  mode?: DateTimeMode;
}

/**
 * Defines a `date` type column in the database schema.
 *
 * @param name Name of the column in database
 * @param options Optional configuration for date parsing and formatting
 * @returns Serializable column definition for a date column.
 */

export function date<const TName extends string, const TOptions extends DateColumnOptions>(
  name: TName,
  options?: TOptions
) {
  return new ColumnDefinition<TName, ColumnConfig<DateValueType<TOptions>, string>>(name, {
    dataType: "date",
    codec: {
      encode: (value) => formatDate(safeParseDate(value)),
      decode: (value) => {
        const date = safeParseDate(value);

        switch (options?.mode) {
          case "iso":
          case "string":
            return formatDate(date) as DateValueType<TOptions>;
          case "date":
          default:
            return date as DateValueType<TOptions>;
        }
      },
    },
  });
}

export type DateValueType<TOptions extends DateColumnOptions> = TOptions["mode"] extends
  | "iso"
  | "string"
  ? string
  : Date;
