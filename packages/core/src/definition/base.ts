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
  TENANT_SCOPE: "TENANT_SCOPE",
  UNION: "UNION",
  UNION_COLUMN: "UNION_COLUMN",
} as const);

export const Relation = Object.freeze({
  HAS_ONE: "has_one",
  HAS_MANY: "has_many",
  BELONGS_TO: "belongs_to",
} as const);

/** The field carrying per-row table metadata on every result record. */
export const META_FIELD = "$$meta";

/**
 * The field naming which member of a union a row came from, on every row of a union result.
 * Top level rather than inside `$$meta`: TypeScript narrows a union on a top-level property
 * only (`docs/decisions/0007-global-ids.md`).
 */
export const KEY_FIELD = "$$key";

/**
 * Field names a table may use for neither a column nor a relation.
 *
 * The runtime writes them onto result records itself, so a field of the same name would be
 * silently overwritten: `$$meta` on every row, `$$key` on every row of a union result. See
 * `docs/decisions/0004-record-meta.md`.
 */
export const RESERVED_FIELD_NAMES: readonly string[] = Object.freeze([META_FIELD, KEY_FIELD]);

export type NodeKind = (typeof Kind)[keyof typeof Kind];
export type RelationType = (typeof Relation)[keyof typeof Relation];

/**
 * Converts a column's values to and from what the driver sends and returns. `encode` takes what
 * a write accepts (`TInput`), `decode` returns what a read yields (`TValue`); they differ only
 * for a column whose writes accept more than its reads return — a JSON column validated by a
 * schema with defaults, for one.
 */
export type ColumnCodec<TRaw, TValue, TInput = TValue> = {
  encode(value: TInput): TRaw;
  decode(raw: TRaw): TValue;
};

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
