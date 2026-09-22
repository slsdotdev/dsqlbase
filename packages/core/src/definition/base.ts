import { SQLIdentifier } from "../sql/nodes.js";
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
  INDEX_COLUMN: "INDEX_COLUMN",
  REFERENCE: "REFERENCE",
  CHECK_CONSTRAINT: "CHECK_CONSTRAINT",
  UNIQUE_CONSTRAINT: "UNIQUE_CONSTRAINT",
  PRIMARY_KEY_CONSTRAINT: "PRIMARY_KEY_CONSTRAINT",
} as const);

export const Relation = Object.freeze({
  HAS_ONE: "has_one",
  HAS_MANY: "has_many",
  BELONGS_TO: "belongs_to",
} as const);

/** The field carrying per-row table metadata on every result record. */
export const META_FIELD = "$$meta";

/**
 * Field names a table may use for neither a column nor a relation.
 *
 * The runtime writes them onto result records itself, so a field of the same name would be
 * silently overwritten. `$$key` is reserved ahead of its use as the union-member discriminant
 * (`.claude/proposals/schema-polymorphic-relations.md`): reserving a name costs nothing now
 * and is a breaking change later.
 */
export const RESERVED_FIELD_NAMES: readonly string[] = Object.freeze([META_FIELD, "$$key"]);

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

export class NodeRef<TNode extends DefinitionNode>
  extends SQLIdentifier
  implements TypedObject<TNode["__type"]>
{
  public readonly kind = Kind.REFERENCE;

  declare readonly __type: TNode["__type"];

  constructor(target: TNode) {
    super(target.name);
  }

  toJSON(): TNode["name"] {
    return this.name;
  }
}
