import { SQLIdentifier, SQLNode, SQLParam, SQLQuery } from "../sql/nodes.js";
import { HasDefault, NotNull, WithValueType } from "../utils/index.js";
import { ColumnCodec, defaultCodec, DefinitionNode, Kind } from "./base.js";
import { AnyCheckConstraintDefinition, CheckConstraintDefinition } from "./constraint.js";

export interface DomainConfig<TValueType = unknown, TRawType = unknown> {
  valueType: TValueType;
  rawType: TRawType;
  dataType: string;
  notNull: boolean;
  codec: ColumnCodec<TRawType, TValueType>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDomainDefinition = DomainDefinition<any, any>;

export class DomainDefinition<
  TName extends string,
  TConfig extends DomainConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.DOMAIN;

  declare readonly __type: TConfig;

  protected _dataType: TConfig["dataType"];
  protected _notNull: TConfig["notNull"];
  protected _defaultValue?: SQLNode;
  protected _check?: AnyCheckConstraintDefinition;

  protected _codec: ColumnCodec<this["__type"]["rawType"], this["__type"]["valueType"]>;

  constructor(name: TName, config: Partial<TConfig>) {
    super(name);

    this._dataType = config.dataType ?? "text";
    this._notNull = config.notNull ?? false;
    this._codec = config.codec ?? defaultCodec;
  }

  public notNull(): NotNull<this> {
    this._notNull = true;
    return this as NotNull<this>;
  }

  public default(value: this["__type"]["valueType"]): HasDefault<this> {
    this._defaultValue = new SQLParam(value, this._codec.encode);
    return this as HasDefault<this>;
  }

  public check<T extends string>(cb: (self: SQLIdentifier) => SQLNode, name?: T): this {
    const expression = new SQLQuery(cb(new SQLIdentifier(this.name)));
    this._check = new CheckConstraintDefinition(name ?? `${this.name}_check`, {
      expression,
    });

    return this;
  }

  public $type<T>(): WithValueType<this, T> {
    return this as WithValueType<this, T>;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      dataType: this._dataType,
      notNull: this._notNull,
      defaultValue: this._defaultValue
        ? new SQLQuery(this._defaultValue).toQuery({ inlineParams: true }).text
        : undefined,
      check: this._check?.toJSON(),
    } as const;
  }
}
