import { TypedObject } from "../utils/index.js";
import { ColumnConfig, ColumnDefinition, ColumnRuntimeType } from "../definition/index.js";
import { SQLContext, SQLNode, SQLParam, SQLStatement, isSQLNode, sql } from "../sql/index.js";
import { AnyTable } from "./table.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyColumn = Column<any, any, any>;

/** See {@link Column.rowDecoder}. */
export type ColumnRowDecoder = {
  /** Columns of the same table the decode reads; projected alongside this one. */
  readonly dependsOn: AnyColumn[];
  /** The value from the column's raw value and the raw row it was read from, keyed by column name. */
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
   * whose target is named by a discriminator). When set, `dependsOn` is projected whenever this
   * column is selected, and the value is read through {@link Column.resolveRow} instead of
   * {@link Column.resolve}. Core applies no meaning to it.
   */
  readonly rowDecoder?: ColumnRowDecoder;

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
