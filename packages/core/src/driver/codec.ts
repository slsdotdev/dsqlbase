import { SQLNode } from "../sql/index.js";

export interface ValueEncoder<TIn, TOut = TIn> {
  encode(value: TIn): TOut | SQLNode;
}

export interface ValueDecoder<TIn, TOut = TIn> {
  decode(value: TIn): TOut;
}

export interface ValueCodec<TIn, TOut = TIn>
  extends ValueEncoder<TIn, TOut>, ValueDecoder<TOut, TIn> {}

export const DEFAULT_ENCODER: ValueEncoder<unknown> = {
  encode(value: unknown): unknown {
    return value;
  },
};

export const DEFAULT_DECODER: ValueDecoder<unknown> = {
  decode(value: unknown): unknown {
    return value;
  },
};

export const DEFAULT_CODEC: ValueCodec<unknown> = {
  ...DEFAULT_ENCODER,
  ...DEFAULT_DECODER,
};
