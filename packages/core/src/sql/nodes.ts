import { counter, escapeIdentifier, escapeValue, type ParamIndexCounter } from "./utils.js";

export interface SQLStatement {
  text: string;
  params: unknown[];
}

export interface SQLContext {
  inlineParams: boolean;
  paramCounter: ParamIndexCounter;
  escapeValue(str: string): string;
  escapeIdentifier(str: string): string;

  /**
   * Alias bindings in effect for the subtree being rendered, set by {@link SQLScope}.
   *
   * Keys are opaque to this module — a node that wants to be referenced by an alias looks
   * itself up here and falls back to its own name when absent. Nothing in `sql/` knows what
   * the keys are, which keeps this layer independent of the runtime.
   */
  aliases?: ReadonlyMap<unknown, string>;
}

export type SQLValue = string | number | boolean | bigint | null | object;

export type ValueSerializer<T> = (value: T) => unknown;

export interface SQLNode {
  toSQL(ctx: SQLContext): SQLStatement;
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

export class SQLParam<TValue> implements SQLNode {
  private readonly _value: TValue;
  private readonly _serialize: ValueSerializer<TValue>;

  constructor(value: TValue, serializer: ValueSerializer<TValue> = (value) => value) {
    this._value = value;
    this._serialize = serializer as ValueSerializer<TValue>;
  }

  private _serializeInlineParam(value: unknown, ctx: SQLContext): string {
    if (value === null) return "null";

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "string") {
      return ctx.escapeValue(value);
    }

    if (typeof value === "object") {
      const str = value.toString();
      return str === "[object Object]"
        ? ctx.escapeValue(JSON.stringify(value))
        : ctx.escapeValue(str);
    }

    throw new Error(`Unsupported parameter type: ${typeof value}`);
  }

  toSQL(ctx: SQLContext): SQLStatement {
    const encodedValue = this._value === null ? this._value : this._serialize(this._value);

    if (isSQLNode(encodedValue)) {
      return encodedValue.toSQL(ctx);
    }

    if (ctx.inlineParams) {
      return { text: this._serializeInlineParam(encodedValue, ctx), params: [] };
    }

    const paramIndex = ctx.paramCounter.next();
    return { text: `$${paramIndex}`, params: [encodedValue] };
  }
}

export class SQLWrapper implements SQLNode {
  private readonly _node: SQLNode;

  constructor(node: SQLNode) {
    this._node = node;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    const contents = this._node.toSQL(ctx);

    return {
      text: `(${contents.text})`,
      params: contents.params,
    };
  }
}

/**
 * Renders a subtree with extra alias bindings in scope.
 *
 * Query-builder machinery, deliberately absent from the `sql` tag and the `./sql` barrel:
 * the bindings are keyed by the very node objects the builder threads through a select
 * tree, which is not knowledge a caller can be expected to have. A user-facing way to
 * alias a table in hand-written SQL is a separate thing to design.
 *
 * Scopes nest by rendering with a derived context rather than by mutating a stack, so the
 * innermost binding for a key wins. That is what lets one correlated predicate reference the
 * same table under two different aliases — wrap the outer side in its own scope and it keeps
 * the outer alias even though it is rendered inside the inner query.
 */
export class SQLScope implements SQLNode {
  private readonly _bindings: ReadonlyMap<unknown, string>;
  private readonly _node: SQLNode;

  constructor(bindings: ReadonlyMap<unknown, string>, node: SQLNode) {
    this._bindings = bindings;
    this._node = node;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    const aliases = ctx.aliases ? new Map([...ctx.aliases, ...this._bindings]) : this._bindings;

    return this._node.toSQL({ ...ctx, aliases });
  }
}

export class SQLIdentifier implements SQLNode {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    return { text: ctx.escapeIdentifier(this.name), params: [] };
  }
}

export class SQLQuery<T = unknown> implements SQLNode {
  declare __type: T;

  private readonly _nodes: SQLNode[] = [];

  constructor(nodes: SQLNode | SQLNode[] = []) {
    this._nodes = Array.isArray(nodes) ? nodes : [nodes];
  }

  private _mergeChunks(chunks: SQLStatement[]): SQLStatement {
    const text = chunks.map((chunk) => chunk.text).join("");
    const params = chunks.flatMap((chunk) => chunk.params);

    return { text, params };
  }

  public append(...nodes: SQLNode[]): this {
    this._nodes.push(...nodes);
    return this;
  }

  public toQuery(ctx?: Partial<SQLContext>): SQLStatement {
    return this.toSQL({
      inlineParams: ctx?.inlineParams ?? false,
      paramCounter: ctx?.paramCounter ?? counter(),
      escapeValue: ctx?.escapeValue ?? escapeValue,
      escapeIdentifier: ctx?.escapeIdentifier ?? escapeIdentifier,
    });
  }

  public toSQL(ctx: SQLContext): SQLStatement {
    const chunks: SQLStatement[] = this._nodes.map((node) => node.toSQL(ctx));
    return this._mergeChunks(chunks);
  }
}
