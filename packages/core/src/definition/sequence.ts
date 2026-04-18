import { DefinitionNode, Kind } from "./base.js";
import { SQLIdentifier, SQLQuery } from "../sql/nodes.js";

export class SequenceDefinition<TName extends string> extends DefinitionNode<TName> {
  public readonly kind = Kind.SEQUENCE;

  protected _dataType = "bigint";
  protected _cache = 1;
  protected _cycle = false;
  protected _increment = 1;
  protected _minValue?: number;
  protected _maxValue?: number;
  protected _startValue?: number;
  protected _ownedBy?: SQLIdentifier;

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
      dataType: this._dataType,
      cache: this._cache,
      cycle: this._cycle,
      increment: this._increment,
      minValue: this._minValue,
      maxValue: this._maxValue,
      startValue: this._startValue,
      ownedBy: this._ownedBy ? new SQLQuery(this._ownedBy).toJSON() : undefined,
    } as const;
  }
}
