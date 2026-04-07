import { Table } from "./table.js";
import { sql, SQLStatement } from "../sql/index.js";
import { Entity, EntityKind, Kind } from "./base.js";

export class Schema extends Entity {
  public readonly kind: EntityKind = Kind.SCHEMA;
  public readonly tables: Table[];

  constructor(name: string, tables: Table[] = []) {
    super(name);

    this.tables = tables;
  }

  toSQL(): SQLStatement {
    return sql.identifier(this.name).toSQL();
  }
}
