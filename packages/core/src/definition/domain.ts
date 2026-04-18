import { SQLIdentifier, SQLNode, SQLParam, SQLQuery } from "../sql/nodes.js";
import { HasDefault, NotNull, WithValueType } from "../utils/index.js";
import { ColumnCodec, defaultCodec, DefinitionNode, Kind } from "./base.js";

export interface DomainConfig<TValueType = unknown, TRawType = unknown> {
  valueType: TValueType;
  rawType: TRawType;
  dataType: string;
  notNull: boolean;
  constraint: string;
  codec: ColumnCodec<TRawType, TValueType>;
}

export type AnyDomainDefinition = DomainDefinition<string, DomainConfig>;

export class DomainDefinition<
  TName extends string,
  TConfig extends DomainConfig,
> extends DefinitionNode<TName, TConfig> {
  readonly kind = Kind.DOMAIN;

  declare readonly __type: TConfig;

  protected _dataType: TConfig["dataType"];
  protected _notNull: TConfig["notNull"];
  protected _defaultValue?: SQLNode;
  protected _constraint?: TConfig["constraint"];
  protected _check?: SQLNode;

  protected _codec: ColumnCodec<this["__type"]["rawType"], this["__type"]["valueType"]>;

  constructor(name: TName, config: Partial<TConfig>) {
    super(name);

    this._dataType = config.dataType ?? "text";
    this._notNull = config.notNull ?? false;
    this._constraint = config.constraint;
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

  public check(cb: (self: SQLIdentifier) => SQLNode): this {
    this._check = cb(new SQLIdentifier(this.name));
    return this;
  }

  public constraint(constraint: string): this {
    this._constraint = constraint;
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
      constraint: this._constraint,
      defaultValue: this._defaultValue ? new SQLQuery(this._defaultValue).toJSON() : undefined,
      check: this._check ? new SQLQuery(this._check).toJSON() : undefined,
    } as const;
  }
}
