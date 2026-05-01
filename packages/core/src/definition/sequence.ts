import { DefinitionNode, Kind, NodeRef } from "./base.js";
import { SQLIdentifier, SQLQuery } from "../sql/nodes.js";
import { AnyNamespaceDefinition } from "./namespace.js";

export interface SequenceOptions {
  dataType?: string;
  cache?: number;
  cycle?: boolean;
  increment?: number;
  minValue?: number;
  maxValue?: number;
  startValue?: number;
  ownedBy?: SQLIdentifier;
}

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
  protected _options: SequenceOptions = {
    dataType: "bigint",
    cache: 1,
    cycle: false,
    increment: 1,
  };

  constructor(name: TName, config: Partial<SequenceConfig<TNamespace>> = {}) {
    super(name);

    this._namespace = config.namespace;
  }

  public cache(cache: number): this {
    this._options.cache = cache;
    return this;
  }

  public cycle(): this {
    this._options.cycle = true;
    return this;
  }

  public incrementBy(increment: number): this {
    this._options.increment = increment;
    return this;
  }

  public minValue(minValue: number): this {
    this._options.minValue = minValue;
    return this;
  }

  public maxValue(maxValue: number): this {
    this._options.maxValue = maxValue;
    return this;
  }

  public startWith(startValue: number): this {
    this._options.startValue = startValue;
    return this;
  }

  // TBD - I need to understand how to handle it and that is the use case.
  // public ownedBy(table: string, column: string): this {
  //   this._options.ownedBy = new SQLIdentifier(`${table}.${column}`);
  //   return this;
  // }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      namespace: this._namespace?.toJSON() ?? "public",
      options: {
        dataType: this._options.dataType,
        cache: this._options.cache,
        cycle: this._options.cycle,
        increment: this._options.increment,
        minValue: this._options.minValue,
        maxValue: this._options.maxValue,
        startValue: this._options.startValue,
        ownedBy: this._options.ownedBy
          ? new SQLQuery(this._options.ownedBy).toQuery().text
          : undefined,
      },
    } as const;
  }
}
