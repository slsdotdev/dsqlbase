import { TypedObject } from "../utils/index.js";

export const Kind = Object.freeze({
  SCHEMA: "SCHEMA",
  TABLE: "TABLE",
  COLUMN: "COLUMN",
  INDEX: "INDEX",
  DOMAIN: "DOMAIN",
  SEQUENCE: "SEQUENCE",
  VIEW: "VIEW",
  FUNCTION: "FUNCTION",
  RELATIONS: "RELATIONS",
} as const);

export const Relation = Object.freeze({
  HAS_ONE: "has_one",
  HAS_MANY: "has_many",
  BELONGS_TO: "belongs_to",
} as const);

export type NodeKind = (typeof Kind)[keyof typeof Kind];
export type RelationType = (typeof Relation)[keyof typeof Relation];

export interface ColumnCodec<TRaw, TValue> {
  encode(value: TValue): TRaw;
  decode(raw: TRaw): TValue;
}

export const defaultCodec: ColumnCodec<unknown, unknown> = {
  encode(value) {
    return value;
  },
  decode(raw) {
    return raw;
  },
};

export type DefinitionSchema = Record<string, DefinitionNode>;

export abstract class DefinitionNode<
  TName extends string = string,
  TConfig extends object = object,
> implements TypedObject<TConfig> {
  abstract readonly kind: NodeKind;

  declare readonly __type: TConfig;

  public readonly name: TName;

  constructor(name: TName) {
    this.name = name;
  }

  public toJSON() {
    return {
      kind: this.kind,
      name: this.name,
    };
  }
}
