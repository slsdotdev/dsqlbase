import { TypedObject } from "@dsqlbase/core/utils";
import {
  AnyTable,
  DefinitionSchema,
  ExecutionContext,
  FieldSelection,
  OperationMode,
  OperationRequest,
  Schema,
  SelectOperationArgs,
} from "@dsqlbase/core";
import { FieldSelectionOf, QueryArgs } from "./base.js";

export class RequestNormalizer<TDefinition extends DefinitionSchema> implements TypedObject<
  Schema<TDefinition>
> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext;

  constructor(context: ExecutionContext) {
    this._ctx = context;
  }

  private _getSelectionEntries<TTable extends AnyTable>(
    table: TTable,
    selection: FieldSelectionOf<TTable> | boolean | null | undefined
  ): FieldSelection[] {
    const entries: FieldSelection[] = [];

    if (!selection || typeof selection === "boolean") {
      return entries;
    }

    for (const [fieldName, isSelected] of Object.entries(selection)) {
      if (isSelected) {
        const column = table.getColumn(fieldName);

        if (!column) {
          throw new Error(`Invalid field "${fieldName}" in selection for table "${table.name}".`);
        }

        entries.push([fieldName, column]);
      }
    }

    return entries;
  }

  public normalizeSelect<
    TTable extends AnyTable,
    TArgs extends QueryArgs<TTable, this["__type"]>,
    TMode extends OperationMode,
  >(table: TTable, args: TArgs, mode: TMode): OperationRequest<SelectOperationArgs, TMode> {
    const selection = this._getSelectionEntries(table, args.select);

    return {
      mode,
      args: {
        select: selection,
      },
    };
  }
}
