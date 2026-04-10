import { TableConfig } from "../definition/table.js";
import { SQLNode, SQLStatement } from "../sql/nodes.js";
import { RecordOf, Table } from "./table.js";

type OperationType = "select" | "insert" | "update" | "delete";

interface Operation<
  TTable extends Table<string, TableConfig>,
  TParams extends object,
  TReturn = unknown,
> {
  type: OperationType;
  table: TTable;
  name: string;
  params: TParams;
  query: SQLStatement;
  returnType: TReturn;
}

type SelectArgs = Record<string, unknown>;

interface SelectParams {
  columns: SQLNode[];
  distinct?: boolean;
  where?: SQLNode;
  orderBy?: SQLNode[];
  limit?: number;
  offset?: number;
  having?: SQLNode;
}

interface OperationOptions<TArgs extends Record<string, unknown>> {
  name?: string;
  args: TArgs;
}

export interface SelectOperation<
  TTable extends Table<string, TableConfig>,
  TArgs extends SelectArgs = SelectArgs,
  TReturn = unknown,
> extends Operation<TTable, SelectParams, TReturn> {
  type: "select";
  args: TArgs;
}

export class OperationFactory {
  createSelect<TTable extends Table<string, TableConfig>, TArgs extends SelectArgs>(
    table: TTable,
    config: OperationOptions<TArgs>
  ): SelectOperation<TTable, TArgs, RecordOf<TTable>> {
    const { name, args } = config;

    return {
      type: "select",
      table: table,
      name: name ?? `select_${table.name}`,
      args: args,
      params: {
        columns: [],
      },
      query: { text: "", params: [] },
      returnType: undefined as unknown as RecordOf<TTable>,
    };
  }
}
