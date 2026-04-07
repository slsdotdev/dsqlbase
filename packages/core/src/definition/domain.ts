import { Entity, Kind } from "./base.js";

export class Domain<T> extends Entity<T> {
  readonly kind = Kind.DOMAIN;

  declare readonly __type: T;
}
