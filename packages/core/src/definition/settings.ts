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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySettingDefinition = SettingDefinition<any, any>;

/** One {@link SettingDefinition} per declared column, keyed by the name values are given under. */
export type Settings<TColumns extends Record<string, AnyColumnDefinition>> = {
  readonly [K in keyof TColumns & string]: SettingDefinition<K, TColumns[K]>;
};

/**
 * Declared settings, from column builders: `new SettingsDefinition({ userId:
 * uuid("identity.user_id") })`. Policies and `$onCreate` read one through `settings`
 * (`params.settings.userId`), as a table's are read through `columns`.
 *
 * Not a schema object: it describes the request, not the data, so it has no DDL and the registry
 * and migrations never see it.
 */
export class SettingsDefinition<TColumns extends Record<string, AnyColumnDefinition>> {
  readonly settings: Settings<TColumns>;

  constructor(columns: TColumns) {
    this.settings = this._buildSettings(columns) as Settings<TColumns>;
  }

  private _buildSettings(
    columns: Record<string, AnyColumnDefinition>
  ): Record<string, AnySettingDefinition> {
    const settings: Record<string, AnySettingDefinition> = {};

    for (const [name, column] of Object.entries(columns)) {
      settings[name] = new SettingDefinition(name, column);
    }

    return Object.freeze(settings);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySettingsDefinition = SettingsDefinition<any>;

/** No declared settings: the default for a client created without `settings`. */
export type NoSettings = SettingsDefinition<Record<never, AnyColumnDefinition>>;

/**
 * The values a client may carry for `TSettings`: each declared one optional, typed by its
 * column, `null` meaning unset.
 */
export type SettingValuesOf<TSettings extends AnySettingsDefinition> = {
  [K in keyof TSettings["settings"]]?: TSettings["settings"][K]["__type"]["valueType"] | null;
};

/**
 * A setting standing in for a value of type `T` — what `$onCreate` may return. Structural and
 * read-only, so it stays covariant in `T` and a column's input type keeps its variance.
 */
export type SettingRef<T> = SQLNode & { readonly __type: { readonly valueType: T } };
