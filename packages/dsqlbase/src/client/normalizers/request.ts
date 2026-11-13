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
  RelationSelection,
  FieldMutation,
  SQLValue,
  CountOperationArgs,
  InsertOperationArgs,
  UpdateOperationArgs,
  DeleteOperationArgs,
  AnyUnion,
  Union,
  UnionSelectOperationArgs,
} from "@dsqlbase/core";
import { TableByAlias, UnionCountOperationArgs } from "@dsqlbase/core/runtime";
import { WhereBuilder } from "./where.js";
import { isDefined, isEmptyObject, isNullOrFalse, isPlainObject } from "./utils.js";
import {
  CountArgs,
  CreateArgs,
  DeleteArgs,
  GetArgs,
  JoinExpressionOf,
  QueryArgs,
  RuntimeObject,
  SelectableFieldsOf,
  UnionQueryArgs,
  UpdateArgs,
  UpdateValuesOf,
  WhereExpressionOf,
} from "./base.js";

export class RequestNormalizer<TDefinition extends DefinitionSchema> implements TypedObject<
  Schema<TDefinition>
> {
  declare readonly __type: Schema<TDefinition>;

  private readonly _ctx: ExecutionContext;
  private readonly _where: WhereBuilder;

  constructor(context: ExecutionContext<TDefinition>) {
    this._ctx = context;
    this._where = new WhereBuilder();
  }

  private _assertUniqueKeys<TTable extends AnyTable>(table: TTable, keys: Record<string, unknown>) {
    if (!isPlainObject(keys) || isEmptyObject(keys)) {
      throw new Error(`Provided keys do not match any unique key for table "${table.alias}".`);
    }

    if (!table.uniqueKeys.some((key) => key.every((field) => Object.hasOwn(keys, field)))) {
      const keys = table.uniqueKeys.map((key) => `(${key.join(", ")})`).join(", ");

      throw new Error(
        `Provided keys do not match any unique key for table "${table.alias}". ` +
          `Expected one of: ${keys}.`
      );
    }
  }

  private _parseQuerySelection<TTable extends RuntimeObject>(
    table: TTable,
    query: QueryArgs<TTable, this["__type"]>
  ): ParsedQuerySelection<TTable, this["__type"]> {
    const select = {} as Record<string, unknown>;
    const join = {} as Record<string, unknown>;

    for (const [fieldName, fieldSelection] of Object.entries(query.select ?? {})) {
      if (Object.hasOwn(query.join ?? {}, fieldName)) {
        throw new Error(
          `Relation "${fieldName}" appears in both select and join on "${table.alias}"; ` +
            `name it in one of them.`
        );
      }

      if (table.hasColumn(fieldName)) {
        select[fieldName] = fieldSelection;
        continue;
      }

      if (this._ctx.schema.hasRelation(table.alias, fieldName)) {
        join[fieldName] =
          typeof fieldSelection === "boolean" ? fieldSelection : { select: fieldSelection };
        continue;
      }

      throw new Error(`Invalid field "${fieldName}" in selection for table "${table.alias}".`);
    }

    for (const [fieldName, fieldSelection] of Object.entries(query.join ?? {})) {
      if (!this._ctx.schema.hasRelation(table.alias, fieldName)) {
        throw new Error(`Invalid relation "${fieldName}" in join for table "${table.alias}".`);
      }

      join[fieldName] = fieldSelection;
    }

    return {
      select: isDefined(query.select) ? select : undefined,
      join,
    } as ParsedQuerySelection<TTable, this["__type"]>;
  }

  private _mergeMemberQuery<TUnion extends AnyUnion, TMember extends AnyTable>(
    base: UnionQueryArgs<TUnion, this["__type"]>,
    member: QueryArgs<TMember, this["__type"]> | true | null | undefined
  ): QueryArgs<TMember, this["__type"]> {
    if (!isDefined(member) || member === true) {
      return base;
    }

    const where = [base.where, member.where].filter(isDefined);
    const hasSelect = [base.select, member.select].filter(isDefined).length > 0;
    const hasJoin = [base.join, member.join].filter(isDefined).length > 0;

    return {
      ...member,
      select: hasSelect
        ? {
            ...base.select,
            ...member.select,
          }
        : undefined,
      join: hasJoin
        ? {
            ...base.join,
            ...member.join,
          }
        : undefined,
      where: where.length > 1 ? { and: where } : where[0],
    };
  }

  private _getSelectEntries<TTable extends AnyTable>(
    table: TTable,
    select: SelectableFieldsOf<TTable> | boolean | null | undefined
  ): FieldSelection[] | undefined {
    if (!isDefined(select) || typeof select === "boolean") {
      return undefined;
    }

    const entries: FieldSelection[] = [];

    for (const [fieldName, selection] of Object.entries(select)) {
      if (isNullOrFalse(selection)) {
        continue;
      }

      const column = table.getColumn(fieldName);

      if (!column) {
        throw new Error(`Invalid field "${fieldName}" in selection for table "${table.alias}".`);
      }

      entries.push([fieldName, column]);
    }

    return entries;
  }

  private _getJoinEntries<TTable extends AnyTable>(
    table: TTable,
    join: JoinExpressionOf<TTable, this["__type"]> | null | undefined
  ): RelationSelection[] | undefined {
    if (!isDefined(join)) {
      return undefined;
    }

    const entries: RelationSelection[] = [];

    for (const [relationName, joinQuery] of Object.entries(join)) {
      if (isNullOrFalse(joinQuery)) {
        continue;
      }

      const relation = this._ctx.schema.getRelation(table, relationName);

      if (!relation) {
        throw new Error(`Relation not found for field: ${relationName} on table: ${table.name}`);
      }

      const query = joinQuery === true ? {} : joinQuery;

      entries.push([
        relationName,
        relation.target instanceof Union
          ? this._getUnionSelectArgs(relation.target, query)
          : this._getSelectArgs(relation.target, query),
      ]);
    }

    return entries.length > 0 ? entries : undefined;
  }

  private _getMutationEntries<TTable extends AnyTable>(
    table: TTable,
    values: UpdateValuesOf<TTable>
  ): FieldMutation[] {
    const entries: FieldMutation[] = [];

    for (const [fieldName, value] of Object.entries(values)) {
      const column = table.getColumn(fieldName);

      if (!column) {
        throw new Error(`Invalid field "${fieldName}" in update values for table "${table.name}".`);
      }

      // Read-only columns are dropped rather than refused: the types already exclude them, so a
      // value here arrived through an untyped spread, and whatever owns the column wins anyway.
      if (column.readOnly) {
        continue;
      }

      entries.push([fieldName, value as SQLValue]);
    }

    return entries;
  }

  private _getSelectArgs<TTable extends AnyTable>(
    table: TTable,
    args: QueryArgs<TTable, this["__type"]>
  ): SelectOperationArgs {
    const selection = this._parseQuerySelection(table, args);
    const select = this._getSelectEntries(table, selection.select);
    const join = this._getJoinEntries(table, selection.join);
    const where = this._where.build(table, args.where);

    return {
      select,
      where,
      join,
      orderBy: undefined,
      distinct: args.distinct,
      limit: args.limit,
      offset: args.offset,
    };
  }

  private _getUnionSelectArgs<TUnion extends AnyUnion>(
    union: TUnion,
    args: UnionQueryArgs<TUnion, this["__type"]>
  ): UnionSelectOperationArgs {
    for (const alias of Object.keys(args.on ?? {})) {
      if (!union.hasMember(alias)) {
        throw new Error(
          `"${alias}" in \`on\` is not a member of union "${union.alias}" ` +
            `(members: ${union.memberAliases.join(", ")}).`
        );
      }
    }

    const members: [string, SelectOperationArgs][] = [];

    for (const [alias, member] of Object.entries(union.members)) {
      if (args.on?.[alias] === false) {
        continue;
      }

      const query = this._mergeMemberQuery(args, args.on?.[alias]);

      members.push([
        alias,
        this._getSelectArgs(member as TableByAlias<this["__type"], typeof alias>, query),
      ]);
    }

    return {
      members,
      orderBy: undefined,
      limit: args.limit,
      offset: args.offset,
    };
  }

  public createSelectRequest<TTable extends AnyTable, TMode extends OperationMode>(
    table: TTable,
    query: QueryArgs<TTable, this["__type"]>,
    mode: TMode
  ): OperationRequest<SelectOperationArgs, TMode> {
    const args = this._getSelectArgs(table, query);
    return { args, mode };
  }

  public createGetRequest<TTable extends AnyTable>(
    table: TTable,
    query: GetArgs<TTable, this["__type"]>
  ): OperationRequest<SelectOperationArgs, "one"> {
    this._assertUniqueKeys(table, query.key);

    const args = this._getSelectArgs(table, {
      where: query.key as WhereExpressionOf<TTable>,
      select: query.select,
    });

    return {
      mode: "one",
      args,
    };
  }

  public createCountRequest<TTable extends AnyTable>(
    table: TTable,
    args: CountArgs<TTable>
  ): OperationRequest<CountOperationArgs, "one"> {
    const where = this._where.build(table, args.where);

    return {
      mode: "one",
      args: { where },
    };
  }

  public createInsertRequest<TTable extends AnyTable, TMode extends OperationMode>(
    table: TTable,
    args: CreateArgs<TTable>,
    mode: TMode
  ): OperationRequest<InsertOperationArgs, TMode> {
    const values = this._getMutationEntries(table, args.data);
    const returning = this._getSelectEntries(table, args.return);

    return {
      mode,
      args: {
        data: [values],
        return: returning,
      },
    };
  }

  public createUpdateRequest<TTable extends AnyTable, TMode extends OperationMode>(
    table: TTable,
    args: UpdateArgs<TTable>,
    mode: TMode
  ): OperationRequest<UpdateOperationArgs, TMode> {
    const values = this._getMutationEntries(table, args.set);
    const returning = this._getSelectEntries(table, args.return);
    const where = this._where.build(table, args.where);

    return {
      mode,
      args: {
        set: values,
        where,
        return: returning,
      },
    };
  }

  public createDeleteRequest<TTable extends AnyTable, TMode extends OperationMode>(
    table: TTable,
    args: DeleteArgs<TTable>,
    mode: TMode
  ): OperationRequest<DeleteOperationArgs, TMode> {
    const where = this._where.build(table, args.where);
    const returning = this._getSelectEntries(table, args.return);

    return {
      mode,
      args: {
        where,
        return: returning,
      },
    };
  }

  public createUnionSelectRequest<TUnion extends AnyUnion, TMode extends OperationMode>(
    union: TUnion,
    query: UnionQueryArgs<TUnion, this["__type"]>,
    mode: TMode
  ): OperationRequest<UnionSelectOperationArgs, TMode> {
    const args = this._getUnionSelectArgs(union, query);

    return {
      mode,
      args,
    };
  }

  public createUnionCountRequest<TUnion extends AnyUnion>(
    union: TUnion,
    args?: CountArgs<TUnion>
  ): OperationRequest<UnionCountOperationArgs, "one"> {
    const { members } = this._getUnionSelectArgs(union, { where: args?.where });

    return {
      mode: "one",
      args: { members },
    };
  }
}

export type ParsedQuerySelection<
  TTable extends RuntimeObject,
  TSchema extends Schema<DefinitionSchema>,
> = {
  select: SelectableFieldsOf<TTable>;
  join: JoinExpressionOf<TTable, TSchema>;
};
