import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { SQLIdentifier, SQLQuery } from "../sql/nodes.js";
import { AnyNamespaceDefinition } from "./namespace.js";

export interface SequenceConfig<TNamespace extends AnyNamespaceDefinition> {
  namespace?: NodeRef<TNamespace>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySequenceDefinition = SequenceDefinition<any, any>;

export class SequenceDefinition<
  TName extends string,
  TNamespace extends AnyNamespaceDefinition,
> extends DefinitionNode<TName, SequenceConfig<TNamespace>> {
  public readonly kind = Kind.SEQUENCE;

  protected _namespace?: NodeRef<TNamespace>;
  protected _dataType = "bigint";
  protected _cache = 1;
  protected _cycle = false;
  protected _increment = 1;
  protected _minValue?: number;
  protected _maxValue?: number;
  protected _startValue?: number;
  protected _ownedBy?: SQLIdentifier;

  constructor(name: TName, config: Partial<SequenceConfig<TNamespace>> = {}) {
    super(name);

    this._namespace = config.namespace;
  }

  public cache(cache: number): this {
    this._cache = cache;
    return this;
  }

  public cycle(): this {
    this._cycle = true;
    return this;
  }

  public incrementBy(increment: number): this {
    this._increment = increment;
    return this;
  }

  public minValue(minValue: number): this {
    this._minValue = minValue;
    return this;
  }

  public maxValue(maxValue: number): this {
    this._maxValue = maxValue;
    return this;
  }

  public startWith(startValue: number): this {
    this._startValue = startValue;
    return this;
  }

  // TBD - I need to understand how to handle it and that is the use case.
  // public ownedBy(table: string, column: string): this {
  //   this._ownedBy = new SQLIdentifier(`${table}.${column}`);
  //   return this;
  // }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      namespace: this._namespace?.toJSON() ?? "public",
      dataType: this._dataType,
      cache: this._cache,
      cycle: this._cycle,
      increment: this._increment,
      minValue: this._minValue,
      maxValue: this._maxValue,
      startValue: this._startValue,
      ownedBy: this._ownedBy
        ? new SQLQuery(this._ownedBy).toQuery({ inlineParams: true }).text
        : undefined,
    } as const;
  }
}
