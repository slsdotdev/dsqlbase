import { Column, ColumnBuilder, ColumnConfig } from "../definition/column.js";
import { Table } from "../definition/table.js";
import { Prettify } from "../utils/types.js";

export class TextColumn<T extends ColumnConfig<"string">> extends Column<T> {}

export class TextColumnBuilder extends ColumnBuilder<ColumnConfig<"string">> {
  constructor(name: string) {
    super(name, "string");
  }

  build(table: Table): TextColumn<Prettify<(typeof this)["__type"]>> {
    return new TextColumn(
      table,
      this.config.name,
      this.config as Prettify<(typeof this)["__type"]>
    );
  }
}

export function text(name = ""): TextColumnBuilder {
  return new TextColumnBuilder(name);
}
