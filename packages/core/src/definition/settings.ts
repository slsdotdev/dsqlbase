import { SQLNode, SQLSetting } from "../sql/index.js";
import type { AnyColumnDefinition } from "./column.js";

/**
 * One declared setting: a per-request value, typed and encoded by a column builder.
 *
 * The column's name is the setting's native key — what a database policy would read through
 * `current_setting()` — and its codec encodes the value. Only the codec runs: there is no table
 * for a column hook to read references from, and a setting is compared, never stored.
 */
export class SettingDefinition<
  TName extends string = string,
  TColumn extends AnyColumnDefinition = AnyColumnDefinition,
> extends SQLSetting<TColumn["__type"]["valueType"]> {
  declare readonly name: TName;

  readonly column: TColumn;

  constructor(name: TName, column: TColumn) {
    super(name, column.name, (value) => column["_codec"].encode(value));
    this.column = column;
  }
}

/** Declared settings, keyed by the name values are given under. */
export type SettingsDefinition<TColumns extends Record<string, AnyColumnDefinition>> = {
  readonly [K in keyof TColumns & string]: SettingDefinition<K, TColumns[K]>;
};

export type AnySettingsDefinition = Readonly<Record<string, SettingDefinition>>;

/** No declared settings: the default for a client created without `settings`. */
export type NoSettings = Readonly<Record<never, SettingDefinition>>;

/**
 * The values a client may carry for `TSettings`: each declared one optional, typed by its
 * column, `null` meaning unset.
 */
export type SettingValuesOf<TSettings extends AnySettingsDefinition> = {
  [K in keyof TSettings]?: TSettings[K]["__type"]["valueType"] | null;
};

/**
 * A setting standing in for a value of type `T` — what `$onCreate` may return. Structural and
 * read-only, so it stays covariant in `T` and a column's input type keeps its variance.
 */
export type SettingRef<T> = SQLNode & { readonly __type: { readonly valueType: T } };

/** Declares settings from column builders: `settings({ userId: uuid("identity.user_id") })`. */
export function defineSettings<TColumns extends Record<string, AnyColumnDefinition>>(
  columns: TColumns
): SettingsDefinition<TColumns> {
  const settings: Record<string, SettingDefinition> = {};

  for (const [name, column] of Object.entries(columns)) {
    settings[name] = new SettingDefinition(name, column);
  }

  return Object.freeze(settings) as unknown as SettingsDefinition<TColumns>;
}
