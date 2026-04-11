import { ColumnDefinitionType } from "../definition/column.js";
import { AnyTable } from "./table.js";

export type ColumnValueOf<T extends ColumnDefinitionType> = T["__type"]["notNull"] extends true
  ? string
  : string | null | undefined;

export type CreateRecordOf<TTable extends AnyTable> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["columns"][K] extends ColumnDefinitionType
    ? ColumnValueOf<TTable["columns"][K]>
    : never;
};

export type SelectColumnsOf<TTable extends AnyTable> = {
  [K in keyof TTable["__type"]["columns"]]: TTable["columns"][K] extends ColumnDefinitionType
    ? boolean | null | undefined
    : never;
};

export interface CreateParams<TTable extends AnyTable> {
  data: CreateRecordOf<TTable>;
  return?: SelectColumnsOf<TTable>;
}
