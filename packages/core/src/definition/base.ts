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
  EMBEDDED_OBJECT: "EMBEDDED_OBJECT",
  COLUMN_GROUP: "COLUMN_GROUP",
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
 * Converts a column's values to and from what the driver sends and returns. A codec translates
 * and nothing else: every value bound for the column passes through `encode` — writes, filters,
 * `Column.param` — so a codec that refused values would refuse filters too. Checking a value is
 * {@link ColumnValidator}'s job.
 */
export type ColumnCodec<TRaw, TValue> = {
  encode(value: TValue): TRaw;
  decode(raw: TRaw): TValue;
};

/**
 * Checks a column's values on their way into and out of the database. Writes run `write` before
 * the codec encodes; reads run `read` after it decodes. Filters run neither: a filter value is a
 * pattern to compare with, not a value to store. Either method throws to refuse a value.
 *
 * `write` takes what a write accepts (`TInput`) and returns what is stored (`TValue`); they
 * differ for a column whose writes accept more than its reads return — a JSON column validated
 * by a schema with defaults, for one.
 */
export type ColumnValidator<TValue, TInput = TValue> = {
  write(input: TInput): TValue;
  read(value: TValue): TValue;
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
