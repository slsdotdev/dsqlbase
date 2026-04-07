import { defaultValueEncoder, ValueEncoder } from "./codec.js";
import { counter, escapeIdentifier, escapeValue } from "./utils.js";

export interface SQLStatement {
  text: string;
  params: unknown[];
}

export interface SQLBuildContext {
  inlineParams: boolean;
  paramCounter: ReturnType<typeof counter>;
}

export interface SQLNode {
  toSQL(ctx: SQLBuildContext): SQLStatement;
}

export const isSQLNode = (value: unknown): value is SQLNode => {
  return (
    typeof value === "object" &&
    value !== null &&
    "toSQL" in value &&
    typeof value.toSQL === "function"
  );
};

export class SQLRaw implements SQLNode {
  private readonly _text: string;

  constructor(text: string) {
    this._text = text;
  }

  toSQL(): SQLStatement {
    return { text: this._text, params: [] };
  }
}

export class SQLParam<TValue = unknown> implements SQLNode {
  private readonly _value: TValue;
  private readonly _encoder: ValueEncoder<TValue>;

  constructor(value: TValue, encoder?: ValueEncoder<TValue>) {
    this._value = value;
    this._encoder = encoder ?? (defaultValueEncoder as ValueEncoder<TValue>);
  }

  private _serializeInlineParam(value: TValue): string {
    if (value === null) return "null";

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "string") {
      return escapeValue(value);
    }

    if (typeof value === "object") {
      const str = value.toString();
      return str === "[object Object]" ? escapeValue(JSON.stringify(value)) : escapeValue(str);
    }

    throw new Error(`Unsupported parameter type: ${typeof value}`);
  }

  toSQL(ctx: SQLBuildContext): SQLStatement {
    const encodedValue = this._value === null ? this._value : this._encoder.encode(this._value);

    if (isSQLNode(encodedValue)) {
      return encodedValue.toSQL(ctx);
    }

    if (ctx.inlineParams) {
      return { text: this._serializeInlineParam(encodedValue), params: [] };
    }

    const paramIndex = ctx.paramCounter.next();
    return { text: `$${paramIndex}`, params: [encodedValue] };
  }
}

export class SQLIdentifier implements SQLNode {
  private readonly _name: string;

  constructor(name: string) {
    this._name = name;
  }

  toSQL(): SQLStatement {
    return { text: escapeIdentifier(this._name), params: [] };
  }
}

export class SQLQuery<T = unknown> implements SQLNode {
  private _nodes: SQLNode[] = [];

  declare __type: T;

  private _mergeChunks(chunks: SQLStatement[]): SQLStatement {
    const text = chunks.map((chunk) => chunk.text).join("");
    const params = chunks.flatMap((chunk) => chunk.params);

    return { text, params };
  }

  public append(...nodes: SQLNode[]): this {
    this._nodes.push(...nodes);
    return this;
  }

  public toQuery(options: { inlineParams: boolean } = { inlineParams: false }): SQLStatement {
    return this.toSQL({
      inlineParams: options.inlineParams,
      paramCounter: counter(),
    });
  }

  public toSQL(ctx: SQLBuildContext): SQLStatement {
    const chunks: SQLStatement[] = this._nodes.map((node) => node.toSQL(ctx));
    return this._mergeChunks(chunks);
  }
}
