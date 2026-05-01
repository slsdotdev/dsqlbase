import { SQLIdentifier, SQLNode, SQLParam, SQLQuery } from "../sql/nodes.js";
import { HasDefault, NotNull, PrimaryKey, TypedObject, Unique, ValueType } from "../utils/index.js";
import { ColumnCodec, defaultCodec, DefinitionNode, Kind, NodeRef } from "./base.js";
import { AnyCheckConstraintDefinition, CheckConstraintDefinition } from "./constraint.js";
import { AnyDomainDefinition } from "./domain.js";
import { SequenceOptions } from "./sequence.js";

export type UpdateGuard<T extends TypedObject> = T["__type"] extends { primaryKey: true }
  ? never
  : T;

export type ColumnGeneratedType = "ALWAYS" | "BY DEFAULT";

export interface ColumnGeneratedConfig {
  type: "ALWAYS";
  expression: SQLNode;
  mode: "STORED";
}

export interface ColumnIdentityConfig {
  type: ColumnGeneratedType;
  options?: SequenceOptions;
  sequenceName?: string;
}

export interface ColumnConfig<TValueType = unknown, TRawType = unknown> {
  dataType: string;
  valueType: TValueType;
  rawType: TRawType;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  codec: ColumnCodec<TRawType, TValueType>;
  defaultValue?: SQLNode;
  domain?: NodeRef<AnyDomainDefinition>;
  generated?: ColumnGeneratedConfig;
  identity?: ColumnIdentityConfig;
}

export type AnyColumnDefinition = ColumnDefinition<string, ColumnConfig>;

export class ColumnDefinition<
  TName extends string,
  TConfig extends ColumnConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.COLUMN;

  protected _dataType: string;
  protected _notNull: boolean;
  protected _primaryKey: boolean;
  protected _unique: boolean;
  protected _defaultValue?: SQLNode;
  protected _domain?: NodeRef<AnyDomainDefinition>;
  protected _check?: AnyCheckConstraintDefinition;
  protected _generated?: ColumnGeneratedConfig;
  protected _identity?: ColumnIdentityConfig;

  protected _codec: ColumnCodec<this["__type"]["rawType"], this["__type"]["valueType"]>;
  protected _onCreate?: () => this["__type"]["valueType"];
  protected _onUpdate?: () => this["__type"]["valueType"];

  constructor(name: TName, config: Partial<TConfig> = {}) {
    super(name);

    this._dataType = config.domain?.name ?? config.dataType ?? "text";
    this._notNull = config.notNull ?? false;
    this._primaryKey = config.primaryKey ?? false;
    this._unique = config.unique ?? false;
    this._defaultValue = config.defaultValue;
    this._codec = config.codec ?? defaultCodec;
    this._domain = config.domain;
    this._generated = config.generated;
    this._identity = config.identity;
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
    this._defaultValue = new SQLParam(value, this._codec.encode);
    return this as HasDefault<this>;
  }

  /**
   * Adds a check constraint to the column.
   *
   * The callback receives the column name as a sql indetifier that can be used to build the check expression.
   *
   * @example
   * ```ts
   * column.check((col) => sql`${col} > 0`, "positive_check");
   * ```
   *
   * @param cb a callback that can takes the colun identifier.
   * @param name Constraint name. If not provided, it will be generated as `${columnName}_check`.
   * @returns
   */

  public check(cb: (self: SQLIdentifier) => SQLNode, name?: string): this {
    const sql = new SQLQuery(cb(new SQLIdentifier(this.name)));
    this._check = new CheckConstraintDefinition(name ?? `${this.name}_check`, { expression: sql });

    return this;
  }

  public $type<T>(): ValueType<this, T> {
    return this as ValueType<this, T>;
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

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      dataType: this._dataType,
      notNull: this._notNull,
      primaryKey: this._primaryKey,
      unique: this._unique,
      defaultValue: this._defaultValue
        ? new SQLQuery(this._defaultValue).toQuery({ inlineParams: true }).text
        : null,
      check: this._check?.toJSON() ?? null,
      domain: this._domain?.toJSON() ?? null,
      generated: this._generated
        ? {
            type: this._generated.type,
            expression: new SQLQuery(this._generated.expression).toQuery({ inlineParams: true })
              .text,
            mode: this._generated.mode,
          }
        : null,
      identity: this._identity
        ? {
            type: this._identity.type,
            sequenceName: this._identity.sequenceName,
            options: this._identity.options
              ? {
                  dataType: this._identity.options.dataType,
                  cache: this._identity.options.cache,
                  cycle: this._identity.options.cycle,
                  increment: this._identity.options.increment,
                  minValue: this._identity.options.minValue,
                  maxValue: this._identity.options.maxValue,
                  startValue: this._identity.options.startValue,
                  ownedBy: this._identity.options.ownedBy
                    ? new SQLQuery(this._identity.options.ownedBy).toQuery().text
                    : undefined,
                }
              : null,
          }
        : null,
    } as const;
  }
}
