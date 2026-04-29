import { SQLNode, SQLParam, SQLQuery, SQLRaw } from "../sql/nodes.js";
import { HasDefault, NotNull, WithDomain, WithValueType } from "../utils/index.js";
import { ColumnCodec, defaultCodec, DefinitionNode, Kind, NodeRef } from "./base.js";
import { ColumnConfig, ColumnDefinition } from "./column.js";
import { AnyCheckConstraintDefinition, CheckConstraintDefinition } from "./constraint.js";
import { AnyNamespaceDefinition } from "./namespace.js";

export interface DomainConfig<
  TValueType = unknown,
  TRawType = unknown,
  TNamespace extends AnyNamespaceDefinition = AnyNamespaceDefinition,
> {
  namespace?: NodeRef<TNamespace>;
  valueType: TValueType;
  rawType: TRawType;
  dataType: string;
  notNull: boolean;
  defaultValue?: SQLNode;
  codec: ColumnCodec<TRawType, TValueType>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDomainDefinition = DomainDefinition<string, any, any, any>;

export class DomainDefinition<
  TName extends string,
  TValueType,
  TRawType,
  TNamespace extends AnyNamespaceDefinition,
> extends DefinitionNode<TName, DomainConfig<TValueType, TRawType, TNamespace>> {
  readonly kind = Kind.DOMAIN;

  declare readonly __type: DomainConfig<TValueType, TRawType, TNamespace>;

  protected _namespace?: NodeRef<TNamespace>;
  protected _dataType: DomainConfig<TValueType, TRawType>["dataType"];
  protected _notNull: DomainConfig<TValueType, TRawType>["notNull"];
  protected _defaultValue?: DomainConfig<TValueType, TRawType>["defaultValue"];
  protected _check?: AnyCheckConstraintDefinition;

  protected _codec: ColumnCodec<this["__type"]["rawType"], this["__type"]["valueType"]>;

  constructor(name: TName, config: Partial<DomainConfig<TValueType, TRawType, TNamespace>> = {}) {
    super(name);

    this._dataType = config.dataType ?? "text";
    this._notNull = config.notNull ?? false;
    this._defaultValue = config.defaultValue;
    this._namespace = config.namespace;
    this._codec =
      config.codec ??
      (defaultCodec as ColumnCodec<this["__type"]["rawType"], this["__type"]["valueType"]>);
  }

  public notNull(): NotNull<this> {
    this._notNull = true;
    return this as NotNull<this>;
  }

  public default(value: this["__type"]["valueType"]): HasDefault<this> {
    this._defaultValue = new SQLParam(value, this._codec.encode);
    return this as HasDefault<this>;
  }

  public check<T extends string>(cb: (value: SQLNode) => SQLQuery, name?: T): this {
    const expression = cb(new SQLRaw("VALUE"));
    this._check = new CheckConstraintDefinition(name ?? `${this.name}_check`, {
      expression,
    });

    return this;
  }

  public $type<T>(): WithValueType<this, T> {
    return this as WithValueType<this, T>;
  }

  /**
   * Creates a new column with the the domain as its data type. The column inherits the properties of the domain, such as `NOT NULL` and `DEFAULT` values.
   *
   * @param name The name of the column.
   * @returns A new column definition with the domain applied.
   */

  public column<TColumnName extends string>(
    name: TColumnName
  ): WithDomain<
    ColumnDefinition<
      TColumnName,
      ColumnConfig<this["__type"]["valueType"], this["__type"]["rawType"]>
    >,
    this
  > {
    return new ColumnDefinition(name, {
      dataType: this.name,
      notNull: this._notNull,
      defaultValue: this._defaultValue,
      codec: this._codec,
      domain: new NodeRef(this),
    }) as WithDomain<
      ColumnDefinition<
        TColumnName,
        ColumnConfig<this["__type"]["valueType"], this["__type"]["rawType"]>
      >,
      this
    >;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      namespace: this._namespace?.name ?? "public",
      dataType: this._dataType,
      notNull: this._notNull,
      defaultValue: this._defaultValue
        ? new SQLQuery(this._defaultValue).toQuery({ inlineParams: true }).text
        : undefined,
      check: this._check?.toJSON(),
    } as const;
  }
}
