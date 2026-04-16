import { ColumnConfig, ColumnDefinition } from "@dsqlbase/core";

export interface TimeColumnOptions {
  /**
   * Determines how the time is parsed and formatted, at runtime:
   * - `"string"`: The column will handle time values as strings in 'HH:mm:ss' format.
   * - `"iso"`: The column will handle time values as ISO 8601 time strings (e.g., 'HH:mm:ss.sssZ').
   *
   * @default "string"
   */
  mode?: "string" | "iso";

  /**
   * Whether to include timezone information when encoding/decoding time values:
   * - `true`: Column is defined as `time with time zone` and will handle time values with timezone information (e.g., 'HH:mm:ssZ' or 'HH:mm:ss+00:00').
   * - `false`: Column is defined as `time without time zone` and will handle time values without timezone information (e.g., 'HH:mm:ss').
   * @default false
   */
  tz?: boolean;
}

export function time<const TName extends string, const TOptions extends TimeColumnOptions>(
  name: TName,
  options?: TOptions
) {
  const dataType = options?.tz ? "time with time zone" : "time";

  return new ColumnDefinition<TName, ColumnConfig<string, string>>(name, {
    dataType,
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}
