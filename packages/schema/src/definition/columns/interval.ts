import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";
import {
  Duration,
  formatISODuration,
  formatStringDuration,
  safeParseDuration,
} from "../../utils/duration.js";

export interface IntervalColumnOptions {
  /**
   * Determines how the interval is parsed and formatted, at runtime:
   * - `"iso"`: The column will handle interval values as ISO 8601 duration strings (e.g., 'P3Y6M4DT12H30M5S').
   * - `"string"`: The column will handle interval values as human-readable strings (e.g., '3 years 6 months 4 days 12 hours 30 minutes 5 seconds').
   * - `"object"`: The column will handle interval values as `Duration` objects with properties for years, months, days, hours, minutes, and seconds (e.g., `{ years: 3, months: 6, days: 4, hours: 12, minutes: 30, seconds: 5 }`).
   *
   * @default "object"
   */
  mode?: "iso" | "string" | "object";
}

/**
 * Defines an `interval` data type column in the database schema.
 * @param name Column name
 * @param options Config options
 * @returns Serializable column definition for an interval column.
 */

export function interval<const TName extends string, const TOptions extends IntervalColumnOptions>(
  name: TName,
  options?: TOptions
) {
  return new ColumnDefinition<TName, ColumnConfig<IntervalValueType<TOptions>, string>>(name, {
    dataType: "interval",
    codec: {
      encode: (value) => {
        const duration = safeParseDuration(value);

        switch (options?.mode) {
          case "iso":
            return formatISODuration(duration);
          case "object":
          case "string":
          default:
            return formatStringDuration(duration);
        }
      },
      decode: (value) => {
        const duration = safeParseDuration(value);

        switch (options?.mode) {
          case "iso":
            return formatISODuration(duration) as IntervalValueType<TOptions>;
          case "string":
            return formatStringDuration(duration) as IntervalValueType<TOptions>;
          case "object":
          default:
            return duration as IntervalValueType<TOptions>;
        }
      },
    },
  });
}

export { interval as duration };

export type IntervalValueType<TOptions extends IntervalColumnOptions> = TOptions["mode"] extends
  | "iso"
  | "string"
  ? string
  : Duration;
