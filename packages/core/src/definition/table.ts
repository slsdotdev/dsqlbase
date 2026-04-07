import { sql, SQLBuildContext, SQLStatement } from "../sql/index.js";
import { Entity, EntityKind, Kind } from "./base.js";
import { Schema } from "./schema.js";

export class Table extends Entity {
  readonly kind: EntityKind = Kind.TABLE;

  readonly schema?: Schema;

  constructor(schema: Schema | undefined = undefined, name: string) {
    super(name);

    this.schema = schema;
  }

  toSQL(ctx: SQLBuildContext): SQLStatement {
    if (!this.schema) {
      return sql.identifier(this.name).toSQL();
    }

    return sql.join([sql.identifier(this.schema.name), sql.identifier(this.name)], ".").toSQL(ctx);
  }
}
