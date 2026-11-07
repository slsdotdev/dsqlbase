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

  /** The schema the target lives in, for a target that has one (a domain). */
  readonly namespace?: string;

  constructor(target: TNode, namespace?: string) {
    super(target.name);
    this.namespace = namespace;
  }

  /**
   * How the migration planner keys the target: `namespace.name` outside `public`, the bare name
   * in it. Two objects with one name in different schemas never collide.
   */
  get qualifiedName(): string {
    return this.namespace && this.namespace !== "public"
      ? `${this.namespace}.${this.name}`
      : this.name;
  }

  toJSON(): TNode["name"] {
    return this.name;
  }
}
