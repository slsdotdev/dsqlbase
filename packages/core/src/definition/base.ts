import { SQLBuildContext, SQLNode, SQLStatement } from "../sql/nodes.js";

export const SCHEMA = Symbol.for("dsql:Schema");
export const TABLE = Symbol.for("dsql:Table");
export const COLUMN = Symbol.for("dsql:Column");
export const INDEX = Symbol.for("dsql:Index");
export const DOMAIN = Symbol.for("dsql:Domain");
export const SEQUENCE = Symbol.for("dsql:Sequence");
export const VIEW = Symbol.for("dsql:View");
export const FUNCTION = Symbol.for("dsql:Function");

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

export type EntityKind = (typeof Kind)[keyof typeof Kind];

export interface TypedObject<T> {
  readonly __type: T;
}

export const isEntity = (value: unknown): value is Entity => {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    Object.values(Kind).includes(value.kind as EntityKind)
  );
};

export abstract class Entity<T = unknown> implements SQLNode, TypedObject<T> {
  abstract readonly kind: EntityKind;

  declare readonly __type: T;

  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public toSQL(_ctx: SQLBuildContext): SQLStatement {
    return { text: "", params: [] };
  }
}
