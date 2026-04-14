import { Unique } from "../utils/index.js";
import { DefinitionNode, Kind } from "./base.js";
import { TableConfig, TableDefinition } from "./table.js";

export interface IndexConfig {
  unique: boolean;
  table: TableDefinition<string, TableConfig>;
}

export type AnyIndexDefinition = IndexDefinition<string, IndexConfig>;

export class IndexDefinition<
  TName extends string,
  TConfig extends IndexConfig,
> extends DefinitionNode<TName, TConfig> {
  public readonly kind = Kind.INDEX;

  protected _unique: boolean;
  protected _table?: this["__type"]["table"];

  constructor(name: TName, config: Partial<TConfig> = {}) {
    super(name);

    this._unique = config.unique ?? false;
    this._table = config.table;
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
