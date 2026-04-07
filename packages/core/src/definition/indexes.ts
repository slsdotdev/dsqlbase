import { Entity, Kind } from "./base.js";

import { Table } from "./table.js";

export class Index extends Entity {
  public readonly kind = Kind.INDEX;

  public readonly table: Table;

  constructor(table: Table, name: string) {
    super(name);

    this.table = table;
  }
}
