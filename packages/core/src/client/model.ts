import { TableConfig } from "../definition/table.js";
import { ExecutionContext } from "../execution/context.js";
import { ColumnNamesOf, RecordOf, Table } from "../execution/table.js";

type TableType = Table<string, TableConfig>;

export interface CreateArgs<T extends TableType> {
  data: RecordOf<T>;
  select?: Partial<Record<ColumnNamesOf<T>, boolean | undefined>>;
}

export type CreateResult<T extends CreateArgs<TableType>> =
  T["select"] extends Record<infer CName, infer CSelect>
    ? CSelect extends true
      ? {
          [K in CName]: T["select"][K] extends true ? string : never;
        }
      : never
    : T extends CreateArgs<infer TTable>
      ? RecordOf<TTable>
      : never;

export class ModelClient<TTableName extends string, TTableConfig extends TableConfig> {
  private readonly _ctx: ExecutionContext;
  private readonly _table: Table<TTableName, TTableConfig>;

  constructor(ctx: ExecutionContext, table: Table<TTableName, TTableConfig>) {
    this._ctx = ctx;
    this._table = table;
  }

  async create<TArgs extends CreateArgs<Table<TTableName, TTableConfig>>>(
    args: TArgs
  ): Promise<CreateResult<TArgs>> {
    throw new Error("Not implemented", { cause: args });
  }
}
