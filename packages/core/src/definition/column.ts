import { ValueCodec } from "../sql/codec.js";
import { SQLBuildContext, SQLStatement, sql } from "../sql/index.js";
import { Entity, Kind, TypedObject } from "./base.js";

import { Table } from "./table.js";

export type DataType = "string" | "number" | "boolean" | "bigint" | "object" | "custom";
export type ColumnType = DataType | `${DataType} ${string}`;

export type NotNull<T extends TypedObject<ColumnConfig>> = T & { __type: { nullable: false } };

export type PrimaryKey<T extends TypedObject<ColumnConfig>> = T & {
  __type: { primaryKey: true; nullable: false };
};

export type Unique<T extends TypedObject<ColumnConfig>> = T & {
  __type: { unique: true };
};

export interface ColumnConfig<TColumnType extends ColumnType = ColumnType> {
  name: string;
  columnType: TColumnType;
  type: unknown;
  driverType: unknown;
  nullable: boolean;
  default: boolean;
  primaryKey: boolean;
  unique: boolean;
}

export abstract class Column<TConfig extends ColumnConfig>
  extends Entity<TConfig>
  implements ValueCodec<TConfig["type"], TConfig["driverType"]>
{
  readonly kind = Kind.COLUMN;

  public readonly table: Table;
  public readonly config: TConfig;

  constructor(table: Table, name: string, config: TConfig) {
    super(name);

    this.table = table;
    this.config = config;
  }

  public encode(value: unknown): unknown {
    return value;
  }

  public decode(value: unknown): unknown {
    return value;
  }

  toSQL(ctx: SQLBuildContext): SQLStatement {
    const statement = sql.join([sql.identifier(this.table.name), sql.identifier(this.name)], ".");
    return statement.toSQL(ctx);
  }
}

export abstract class ColumnBuilder<TConfig extends ColumnConfig> implements TypedObject<TConfig> {
  declare readonly __type: TConfig;

  protected readonly config: TConfig;

  constructor(name: string, columnType: ColumnType) {
    this.config = {
      name,
      columnType,
      type: null,
      driverType: null,
      nullable: true,
      default: false,
      primaryKey: false,
      unique: false,
    } as TConfig;
  }

  public notNull(): NotNull<this> {
    this.config.nullable = false;
    return this as NotNull<this>;
  }

  public primaryKey(): PrimaryKey<this> {
    this.config.primaryKey = true;
    this.config.nullable = false;
    return this as PrimaryKey<this>;
  }

  public unique(): Unique<this> {
    this.config.unique = true;
    return this as Unique<this>;
  }

  public default(): this {
    this.config.default = true;
    return this;
  }

  public abstract build(table: Table): Column<TConfig>;
}
