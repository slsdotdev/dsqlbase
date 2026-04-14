import {
  HasDefault,
  NotNull,
  PrimaryKey,
  TypedObject,
  Unique,
  WithValueType,
} from "../utils/index.js";
import { ColumnCodec, DefinitionNode, Kind } from "./base.js";

export type UpdateGuard<T extends TypedObject> = T["__type"] extends { primaryKey: true }
  ? never
  : T;

export interface ColumnConfig<TValueType = unknown, TRawType = unknown> {
  dataType: string;
  valueType: TValueType;
  rawType: TRawType;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  codec: ColumnCodec<TRawType, TValueType>;
}

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
  protected _codec?: ColumnCodec<this["__type"]["rawType"], this["__type"]["valueType"]>;
  protected _onCreate?: () => this["__type"]["valueType"];
  protected _onUpdate?: () => this["__type"]["valueType"];

  constructor(name: TName, config: Partial<TConfig> = {}) {
    super(name);

    this._dataType = config.dataType ?? "text";
    this._notNull = config.notNull ?? false;
    this._primaryKey = config.primaryKey ?? false;
    this._unique = config.unique ?? false;
    this._codec = config.codec;
  }

  /**
   * Marks the column as `NOT NULL`. This means that the column cannot contain null values.
   */
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

  public $type<T>(): WithValueType<this, T> {
    return this as WithValueType<this, T>;
  }

  public $onCreate(cb: () => this["__type"]["valueType"]): this {
    this._onCreate = cb;
    return this;
  }

  public $onUpdate(cb: () => this["__type"]["valueType"]): UpdateGuard<this> {
    if (this._primaryKey) {
      throw new Error("Cannot set onUpdate callback for a primary key column.");
    }

    this._onUpdate = cb;
    return this as UpdateGuard<this>;
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
