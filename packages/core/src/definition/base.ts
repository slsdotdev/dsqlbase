import { TypedObject } from "../types/object.js";

export const Kind = Object.freeze({
  SCHEMA: "SCHEMA",
  TABLE: "TABLE",
  COLUMN: "COLUMN",
  INDEX: "INDEX",
  DOMAIN: "DOMAIN",
  SEQUENCE: "SEQUENCE",
  VIEW: "VIEW",
  FUNCTION: "FUNCTION",
} as const);

export type NodeKind = (typeof Kind)[keyof typeof Kind];

export type SerializedNode<T extends DefinitionNode<string>> =
  T extends DefinitionNode<string> ? ReturnType<T["toJSON"]> : never;

export abstract class DefinitionNode<
  TName extends string,
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
