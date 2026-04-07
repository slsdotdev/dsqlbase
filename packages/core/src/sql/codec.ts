import { SQLNode } from "./nodes.js";

export interface ValueEncoder<TIn, TOut = TIn> {
  encode(value: TIn): TOut | SQLNode;
}

export interface ValueDecoder<TIn, TOut = TIn> {
  decode(value: TIn): TOut;
}

export interface ValueCodec<TIn, TOut = TIn>
  extends ValueEncoder<TIn, TOut>, ValueDecoder<TOut, TIn> {}

export const defaultValueEncoder: ValueEncoder<unknown> = {
  encode(value: unknown): unknown {
    return value;
  },
};

export const defaultValueDecoder: ValueDecoder<unknown> = {
  decode(value: unknown): unknown {
    return value;
  },
};
