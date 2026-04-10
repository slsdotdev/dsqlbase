import { Unique } from "../types/object.js";
import { DefinitionNode, Kind } from "./base.js";
import { TableConfig, TableDefinition } from "./table.js";

export interface IndexConfig {
  unique: boolean;
}

export class IndexDefinition<
  TName extends string,
  TConfig extends IndexConfig,
  TTable extends TableDefinition<string, TableConfig>,
> extends DefinitionNode<TName, TConfig> {
  public readonly kind = Kind.INDEX;

  protected _unique: boolean;
  protected _table: TTable;

  constructor(name: TName, config: Partial<TConfig> = {}, table: TTable) {
    super(name);

    this._unique = config.unique ?? false;
    this._table = table;
  }

  public unique(): Unique<this> {
    this._unique = true;
    return this as Unique<this>;
  }

  toJSON() {
    return {
      kind: this.kind,
      name: this.name,
      unique: this._unique,
    };
  }
}
