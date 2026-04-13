import { HasDefault, NotNull, PrimaryKey, Unique } from "../types/object.js";
import { DefinitionNode, Kind } from "./base.js";

export type DataType = "string" | "number" | "boolean" | "bigint" | "object" | "custom";
export type ColumnType = DataType | `${DataType} ${string}`;

export interface ColumnConfig<TValueType = string> {
  dataType: string;
  valueType: TValueType;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
}

export type ValueType<T extends ColumnConfig, TValue> = {
  [K in keyof T]: K extends "valueType" ? TValue : T[K];
};

export type AnyColumnDefinition = ColumnDefinition<string, ColumnConfig>;

export class ColumnDefinition<
  TName extends string,
  TConfig extends ColumnConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.COLUMN;

  protected _notNull: boolean;
  protected _primaryKey: boolean;
  protected _unique: boolean;
  protected _dataType: string;
  protected _defaultValue?: this["__type"]["valueType"];

  constructor(name: TName, config: Partial<TConfig> = {}) {
    super(name);

    this._dataType = config.dataType ?? "text";
    this._notNull = config.notNull ?? false;
    this._primaryKey = config.primaryKey ?? false;
    this._unique = config.unique ?? false;
  }

  public notNull(): NotNull<this> {
    this._notNull = true;
    return this as NotNull<this>;
  }

  public primaryKey(): PrimaryKey<this> {
    this._primaryKey = true;
    this._notNull = true;
    return this as PrimaryKey<this>;
  }

  public unique(): Unique<this> {
    this._unique = true;
    return this as Unique<this>;
  }

  public default(value: this["__type"]["valueType"]): HasDefault<this> {
    this._defaultValue = value;
    return this as HasDefault<this>;
  }

  public $type() {
    return this;
  }

  public $onCreate(): this {
    return this;
  }

  public $onUpdate(): this {
    return this;
  }

  // public $validate(cb: (value: this["__type"]["valueType"]) => boolean): this {
  //   return this;
  // }

  // public $parse<T>(cb: (value: this["__type"]["valueType"]) => T): ValueType<this, T> {
  //   return this as ValueType<this, T>;
  // }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      dataType: this._dataType,
      notNull: this._notNull,
      primaryKey: this._primaryKey,
      unique: this._unique,
    } as const;
  }
}
