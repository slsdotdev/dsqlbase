import { TypedObject } from "../utils/index.js";
import { ColumnConfig, ColumnDefinition, ColumnRuntimeType } from "../definition/index.js";
import { SQLContext, SQLNode, SQLParam, SQLStatement, isSQLNode, sql } from "../sql/index.js";
import { AnyTable } from "./table.js";
import {
  ColumnReference,
  ComputedDiscriminator,
  ReferenceEnd,
  ResolvedReferences,
  isSameReference,
} from "./reference.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyColumn = Column<any, any, any>;

/** See {@link Column.rowDecoder}. */
export type ColumnRowDecoder = {
  /**
   * The value from the column's raw value and the raw row it was read from, keyed by column
   * name. The row carries {@link Column.dependsOn}, which core projects with the column.
   */
  decode(raw: unknown, row: Record<string, unknown>): unknown;
};

export class Column<TName extends string, TConfig extends ColumnConfig, TTable extends AnyTable>
  implements SQLNode, TypedObject<TConfig>
{
  declare readonly __type: TConfig;

  readonly codec: ColumnDefinition<TName, TConfig>["_codec"];
  /** Checks writes before they are encoded and reads after they are decoded; never filters. */
  readonly validator: ColumnDefinition<TName, TConfig>["_validator"];
  readonly onCreate: ColumnDefinition<TName, TConfig>["_onCreate"];
  readonly onUpdate: ColumnDefinition<TName, TConfig>["_onUpdate"];

  readonly table: TTable;
  readonly name: TName;
  /** The database type, or the domain's name for a domain column. */
  readonly dataType: string;
  /** The kind of value the column holds, for querying; see {@link ColumnRuntimeType}. */
  readonly runtimeType: ColumnRuntimeType;
  /**
   * Whether a JSON projection (a joined row, a union row) must carry this column as text. The
   * driver hands a root read of `bigint` and `numeric` to the codec as the database's exact
   * text; `row_to_json` would emit a JSON number, already rounded to a double before the codec
   * sees it. Cast, the codec gets the same string either way.
   */
  readonly textInJson: boolean;
  readonly notNull: TConfig["notNull"];
  readonly primaryKey: TConfig["primaryKey"];
  readonly unique: TConfig["unique"];
  readonly readOnly: TConfig["readOnly"];
  readonly tenantKey: TConfig["tenantKey"];

  constructor(table: TTable, definition: ColumnDefinition<TName, TConfig>) {
    this.table = table;
    this.name = definition.name;
    this.dataType = definition["_dataType"];
    this.runtimeType = definition["_runtimeType"];
    this.textInJson =
      this.runtimeType === "bigint" || /^(bigint|int8|numeric|decimal)\b/i.test(this.dataType);
    this.notNull = definition["_notNull"];
    this.primaryKey = definition["_primaryKey"];
    this.unique = definition["_unique"];
    this.readOnly = definition["_readOnly"];
    this.tenantKey = definition["_tenantKey"];

    this.codec = definition["_codec"];
    this.validator = definition["_validator"];
    this.onCreate = definition["_onCreate"];
    this.onUpdate = definition["_onUpdate"];
  }

  /**
   * A decode that needs more than the column's own value — sibling columns of the same row.
   *
   * Unset by default; a client sets it on the built column when it is created, as it does a
   * bound codec, for a value whose meaning depends on another column (a polymorphic reference
   * whose target is named by a discriminator). When set, the value is read through
   * {@link Column.resolveRow} instead of {@link Column.resolve}; the siblings it may read are
   * {@link Column.dependsOn}, which core projects whether or not a decoder is set. Core applies
   * no meaning to it.
   */
  readonly rowDecoder?: ColumnRowDecoder;

  private _references: ColumnReference[] = [];
  private _referencesFrozen = false;

  /**
   * What this column points at, one entry per relation that makes it a foreign key. Set by the
   * `SchemaRegistry` while it builds relations, for every column type; empty for a column no
   * relation references through. A column may point at more than one target — a plain key can
   * be a foreign key of two tables — and what that means is left to the reader.
   */
  public get references(): readonly ColumnReference[] {
    return this._references;
  }

  /**
   * What gives this column's value its meaning, read from the same row: the discriminator of
   * each union reference — a sibling column, or a {@link ComputedDiscriminator}. Projected alongside the column whenever it is
   * selected.
   */
  public get dependsOn(): readonly (AnyColumn | ComputedDiscriminator)[] {
    const dependencies: (AnyColumn | ComputedDiscriminator)[] = [];

    for (const reference of this._references) {
      if (reference.kind === "union" && !dependencies.includes(reference.discriminator)) {
        dependencies.push(reference.discriminator);
      }
    }

    return dependencies;
  }

  /**
   * @internal Called by `SchemaRegistry` while it builds relations. A reference already held is
   * skipped, not refused: both sides of one relation declare the same reference. So is a
   * column referencing itself.
   */
  public _addReference(reference: ColumnReference): void {
    if (this._referencesFrozen) {
      throw new Error(
        `Column "${this.table.name}"."${this.name}" is already built; its references are fixed.`
      );
    }

    // A pair of a column with itself says nothing about where it points.
    if (reference.kind === "table" && reference.column === this) {
      return;
    }

    if (this._references.some((existing) => isSameReference(existing, reference))) {
      return;
    }

    this._references = [...this._references, reference];
  }

  /** @internal Called by `SchemaRegistry` once every relation is built. */
  public _freezeReferences(): void {
    this._referencesFrozen = true;
    Object.freeze(this._references);
  }

  /**
   * Follows this column's references to where each chain ends. A table reference continues
   * through the column it points at; a union reference is an end of its own, since its member
   * is only known per row — given the `row`, it resolves to the member column its discriminator
   * names, or to nothing when the discriminator is null or names no member.
   *
   * Never throws: two ends, or a ring, can be legitimate for a plain key, so it is the caller
   * who decides whether they are a conflict.
   */
  public resolveReferences(row?: Record<string, unknown>): ResolvedReferences {
    const ends: ReferenceEnd[] = [];
    let ring: AnyColumn[] | undefined;

    const addEnd = (end: ReferenceEnd) => {
      const known = ends.some((existing) =>
        existing.kind === "table" && end.kind === "table"
          ? existing.column === end.column
          : existing.kind === "union" &&
            end.kind === "union" &&
            isSameReference(existing.reference, end.reference)
      );

      if (!known) {
        ends.push(end);
      }
    };

    const walk = (column: AnyColumn, path: AnyColumn[]) => {
      if (path.includes(column)) {
        ring ??= [...path.slice(path.indexOf(column)), column];
        return;
      }

      if (column.references.length === 0) {
        addEnd({ kind: "table", column });
        return;
      }

      for (const reference of column.references) {
        if (reference.kind === "table") {
          walk(reference.column, [...path, column]);
          continue;
        }

        if (!row) {
          addEnd({ kind: "union", reference });
          continue;
        }

        // Only the column the row was read from has its discriminator in the row.
        const key = column === this ? row[reference.discriminator.name] : undefined;

        if (typeof key === "string" && Object.hasOwn(reference.members, key)) {
          walk(reference.members[key], [...path, column]);
        }
      }
    };

    walk(this, []);

    return ring ? { ends, ring } : { ends };
  }

  /** Reads this column's value from a whole row, through {@link Column.rowDecoder} if set. */
  public resolveRow(row: Record<string, unknown>): TConfig["valueType"] {
    const raw = row[this.name];

    if (!this.rowDecoder || raw === null || raw === undefined) {
      return this.resolve(raw as TConfig["rawType"]);
    }

    return this._validateRead(this.rowDecoder.decode(raw, row) as TConfig["valueType"]);
  }

  public resolve(value: TConfig["rawType"]): TConfig["valueType"] {
    if (value === null || value === undefined) {
      if (this.notNull) {
        throw new Error(`Column ${this.name} cannot be null`);
      }

      return null;
    }

    return this._validateRead(this.codec.decode(value));
  }

  private _validateRead(value: TConfig["valueType"]): TConfig["valueType"] {
    return this.validator ? this.validator.read(value) : value;
  }

  /** A write's value as sent: validated, if the column has a validator, then encoded. */
  private readonly _encodeInput = (input: TConfig["inputType"]): TConfig["rawType"] =>
    this.codec.encode(this.validator ? this.validator.write(input) : input);

  /**
   * Wraps a value as a parameter encoded by this column's codec. It is not validated: a filter
   * value is compared with stored values, not stored, and may be a fragment of one.
   *
   * This is the filter counterpart to {@link Column.getInsertValue} and
   * {@link Column.getUpdateValue}: a `date`, `bigint` or `interval` column only matches if
   * the value on the wire is written the same way it was stored. A value that is already an
   * `SQLNode` — another column, a sub-expression — is passed through untouched, since it is
   * SQL rather than a value to encode.
   *
   * Also the way to filter by a codec column in raw `$query`:
   * ``sql`${users.columns.createdAt} > ${users.columns.createdAt.param(cutoff)}` ``
   */
  public param(value: TConfig["valueType"] | SQLNode): SQLNode {
    if (isSQLNode(value)) {
      return value;
    }

    return new SQLParam(value, this.codec.encode);
  }

  public getInsertValue(
    value: TConfig["inputType"] | SQLParam<TConfig["inputType"]> | null | undefined
  ) {
    let param = value ?? undefined;

    if (param === undefined) {
      param = this.onCreate?.() ?? sql.raw("DEFAULT");
    }

    if (param instanceof SQLParam) {
      param = new SQLParam(param["_value"], this._encodeInput);
    }

    if (!isSQLNode(param)) {
      param = new SQLParam(param, this._encodeInput);
    }

    return param as SQLNode;
  }

  getUpdateValue(value: TConfig["inputType"] | SQLParam<TConfig["inputType"]> | null | undefined) {
    let param = value;

    if (param === undefined) {
      param = this.onUpdate?.() ?? undefined;
    }

    if (param instanceof SQLParam) {
      param = new SQLParam(param["_value"], this._encodeInput);
    }

    // `param`, not `value`: an `$onUpdate` result is a value to validate and encode as well.
    if (param !== undefined && !isSQLNode(param)) {
      param = new SQLParam(param, this._encodeInput);
    }

    return param as SQLNode;
  }

  toSQL(ctx: SQLContext): SQLStatement {
    // The table decides how it is named here: an alias when one is bound for it in this
    // scope, otherwise its plain name. Outside a select tree nothing is bound, so this
    // renders `"table"."column"` exactly as it always has.
    return sql.join([this.table.ref(), sql.identifier(this.name)], ".").toSQL(ctx);
  }
}
