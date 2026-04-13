/* eslint-disable @typescript-eslint/no-explicit-any */

export type Prettify<T extends object> = {
  [K in keyof T]: T[K];
} & {};

export type UnionToIntersection<T> = (T extends any ? (x: T) => any : never) extends (
  x: infer R
) => any
  ? R
  : never;
