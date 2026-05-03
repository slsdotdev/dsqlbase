import {
  AnyColumnDefinition,
  AnyConstraintDefinition,
  AnyIndexDefinition,
  AnyTableDefinition,
  DefinitionNode,
} from "@dsqlbase/core/definition";
import { SchemaObjectType, SerializedObject } from "../../base.js";
import {
  AnyAlterTableAction,
  AlterColumnSubAction,
  ColumnDefinitionExpression,
  IndexColumnExpression,
  TableConstraintExpression,
} from "../../ddl/ast.js";
import { ddl } from "../../ddl/index.js";
import { Diff, DiffType } from "../diffs/base.js";
import { diffTable } from "../diffs/table.js";
import {
  DDLOperation,
  DDLOperationError,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
  qualifiedName,
  refusal,
} from "./base.js";

type ColumnSerialized = SerializedObject<AnyColumnDefinition>;
type IndexSerialized = SerializedObject<AnyIndexDefinition>;
type ConstraintSerialized = SerializedObject<AnyConstraintDefinition>;
type AnyDiff = Diff<DiffType, SerializedObject<DefinitionNode>>;

const uniqueIndexNameForColumn = (table: string, column: string) => `${table}_${column}_key_idx`;
const uniqueConstraintNameForColumn = (table: string, column: string) => `${table}_${column}_key`;
const uniqueIndexNameForConstraint = (constraint: string) => `${constraint}_idx`;

export function createTableOperation(
  object: SerializedObject<AnyTableDefinition>,
  ifNotExists = true
): DDLOperation {
  const references: string[] = maybeNamespaceReference(object) ?? [];
  const columns: ColumnDefinitionExpression[] = [];
  const constraints: TableConstraintExpression[] = [];

  for (const column of object.columns as SerializedObject<AnyColumnDefinition>[]) {
    if (column.domain) {
      references.push(column.domain);
    }

    columns.push(
      ddl.column({
        name: column.name,
        dataType: column.dataType,
        isPrimaryKey: column.primaryKey,
        notNull: column.notNull,
        defaultValue: column.defaultValue,
        unique: column.unique,
        check: column.check
          ? ddl.check({ name: column.check.name, expression: column.check.expression })
          : undefined,
      })
    );
  }

  for (const constraint of object.constraints) {
    if (constraint.kind === "CHECK_CONSTRAINT") {
      constraints.push(
        ddl.check({
          name: constraint.name,
          expression: constraint.expression,
        })
      );
    }

    if (constraint.kind === "PRIMARY_KEY_CONSTRAINT") {
      constraints.push(
        ddl.primaryKey({
          name: constraint.name,
          columns: constraint.columns,
          include: constraint.include,
        })
      );
    }

    if (constraint.kind === "UNIQUE_CONSTRAINT") {
      constraints.push(
        ddl.unique({
          name: constraint.name,
          columns: constraint.columns,
          include: constraint.include ?? undefined,
          nullsDistinct: constraint.distinctNulls,
        })
      );
    }
  }

  const statement = ddl.createTable({
    name: object.name,
    ifNotExists,
    columns,
    constraints,
  });

  return {
    type: "CREATE",
    object: object,
    statement,
    references,
  };
}

export function createIndexOperation(
  index: SerializedObject<AnyIndexDefinition>,
  tableName: string,
  ifNotExists = true,
  async = false
): DDLOperation {
  const references: string[] = maybeNamespaceReference(index) ?? [];
  references.push(tableName);

  const columns: IndexColumnExpression[] = [];

  for (const column of index.columns) {
    columns.push(
      ddl.indexColumn({
        columnName: column.name,
        nulls: column.nulls,
      })
    );
  }

  const statement = ddl.createIndex({
    name: index.name,
    tableName,
    unique: index.unique,
    columns,
    include: index.include ?? undefined,
    nullsDistinct: index.distinctNulls,
    ifNotExists,
    async: async ? true : undefined,
  });

  return {
    type: "CREATE",
    object: index,
    statement,
    references,
  };
}

export function dropTableOperation(
  object: SerializedObject<AnyTableDefinition>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  return {
    type: "DROP",
    object: object,
    statement: ddl.dropTable({
      name: object.name,
      ifExists: options.safeOperations,
      cascade: options.safeOperations ? "CASCADE" : "RESTRICT",
    }),
    references: maybeNamespaceReference(object),
  };
}

export function dropIndexOperation(
  object: SerializedObject<AnyIndexDefinition>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  return {
    type: "DROP",
    object,
    statement: ddl.dropIndex({
      name: object.name,
      ifExists: options.safeOperations,
      cascade: options.safeOperations ? "CASCADE" : "RESTRICT",
    }),
    references: maybeNamespaceReference(object),
  };
}

export function diffTableOperations(
  local: SerializedObject<AnyTableDefinition>,
  remote?: SerializedObject<SchemaObjectType>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): OperationResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  if (!remote) {
    const tableName = qualifiedName(local);
    operations.push(createTableOperation(local, options.safeOperations));

    if (local.indexes.length) {
      for (const idx of local.indexes) {
        operations.push(
          createIndexOperation(idx, tableName, options.safeOperations, options.asyncIndexes)
        );
      }
    }

    return { operations, errors };
  }

  if (remote.kind !== "TABLE") {
    errors.push(kindMismatchError("TABLE", remote));

    return { operations, errors };
  }

  const tableName = qualifiedName(local);
  const tableNamespaceRef = maybeNamespaceReference(local) ?? [];
  const ctx: TableProcessingContext = { local, tableName, tableNamespaceRef };

  const buckets = bucketDiffs(diffTable(local, remote) as unknown as AnyDiff[]);

  const columnResult = processColumnDiffs(buckets.columns, ctx);
  const indexResult = processIndexDiffs(buckets.indexes, ctx, options);
  const constraintResult = processConstraintDiffs(buckets.constraints, ctx);

  errors.push(...columnResult.errors, ...indexResult.errors, ...constraintResult.errors);
  operations.push(
    ...columnResult.operations,
    ...indexResult.operations,
    ...constraintResult.operations
  );

  if (columnResult.tableActions.length > 0) {
    operations.unshift({
      type: "ALTER",
      object: local,
      statement: ddl.alterTable({ name: local.name, actions: columnResult.tableActions }),
      references: dedupe([...tableNamespaceRef, ...columnResult.references]),
    });
  }

  return { operations, errors };
}

interface TableProcessingContext {
  local: SerializedObject<AnyTableDefinition>;
  tableName: string;
  tableNamespaceRef: string[];
}

interface ColumnProcessingResult {
  tableActions: AnyAlterTableAction[];
  operations: DDLOperation[];
  errors: DDLOperationError[];
  references: string[];
}

interface SubjectProcessingResult {
  operations: DDLOperation[];
  errors: DDLOperationError[];
}

function bucketDiffs(diffs: AnyDiff[]) {
  const columns = new Map<string, AnyDiff[]>();
  const indexes = new Map<string, AnyDiff[]>();
  const constraints = new Map<string, AnyDiff[]>();

  for (const diff of diffs) {
    const target = diff.kind === "COLUMN" ? columns : diff.kind === "INDEX" ? indexes : constraints;
    const list = target.get(diff.name) ?? [];

    list.push(diff);
    target.set(diff.name, list);
  }

  return { columns, indexes, constraints };
}

function dedupe(values: string[]): string[] | undefined {
  if (values.length === 0) return undefined;
  return Array.from(new Set(values));
}

function processColumnDiffs(
  columnDiffs: Map<string, AnyDiff[]>,
  ctx: TableProcessingContext
): ColumnProcessingResult {
  const tableActions: AnyAlterTableAction[] = [];
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  const references: string[] = [];

  for (const [columnName, diffsForColumn] of columnDiffs) {
    const wholeAdd = diffsForColumn.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForColumn.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForColumn.filter((d) => d.key !== undefined);

    if (wholeRemove) {
      errors.push(
        refusal({
          code: "NO_DROP_COLUMN",
          message: `Column "${columnName}" cannot be dropped: DSQL does not support DROP COLUMN.`,
          object: wholeRemove.object,
          subject: columnName,
          diffs: [wholeRemove],
        })
      );
      continue;
    }

    if (wholeAdd) {
      const result = handleColumnAdd(wholeAdd, ctx);
      tableActions.push(...result.tableActions);
      operations.push(...result.operations);
      errors.push(...result.errors);
      references.push(...result.references);
      continue;
    }

    const result = handleColumnModify(columnName, attrDiffs, ctx);
    tableActions.push(...result.tableActions);
    operations.push(...result.operations);
    errors.push(...result.errors);
  }

  return { tableActions, operations, errors, references };
}

function handleColumnAdd(diff: AnyDiff, ctx: TableProcessingContext): ColumnProcessingResult {
  const column = diff.object as ColumnSerialized;
  const blocked = nonPromotableInlineAttrs(column);

  if (blocked.length > 0) {
    return {
      tableActions: [],
      operations: [],
      references: [],
      errors: [
        refusal({
          code: "IMMUTABLE_COLUMN",
          message:
            `Column "${column.name}" cannot be added with inline ${blocked.join(", ")}: ` +
            `DSQL only supports bare ADD COLUMN. Add the column without these attributes ` +
            `or recreate the table.`,
          object: column,
          subject: column.name,
          diffs: [diff],
        }),
      ],
    };
  }

  const tableActions: AnyAlterTableAction[] = [
    ddl.addColumn({
      column: ddl.column({
        name: column.name,
        dataType: column.dataType,
        isPrimaryKey: false,
        notNull: false,
        unique: false,
        defaultValue: null,
      }),
    }),
  ];
  const operations: DDLOperation[] = [];
  const references: string[] = [];

  if (column.domain) {
    references.push(column.domain);
  }

  if (column.identity) {
    tableActions.push(
      ddl.alterColumn({
        columnName: column.name,
        actions: [
          ddl.addIdentity({
            mode: column.identity.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT",
            options: column.identity.options
              ? sequenceOptionsFromIdentity(column.identity.options)
              : undefined,
          }),
        ],
      })
    );
  }

  if (column.unique) {
    operations.push(
      ...uniquePromotionOps({
        tableName: ctx.tableName,
        tableNamespaceRef: ctx.tableNamespaceRef,
        indexName: uniqueIndexNameForColumn(ctx.local.name, column.name),
        constraintName: uniqueConstraintNameForColumn(ctx.local.name, column.name),
        columns: [column.name],
      })
    );
  }

  return { tableActions, operations, references, errors: [] };
}

function handleColumnModify(
  columnName: string,
  attrDiffs: AnyDiff[],
  ctx: TableProcessingContext
): ColumnProcessingResult {
  const blocked: AnyDiff[] = [];
  const blockedAttrs: string[] = [];
  const subActions: AlterColumnSubAction[] = [];
  let promoteUnique = false;

  for (const diff of attrDiffs) {
    const key = diff.key as string;
    switch (key) {
      case "dataType":
      case "domain":
      case "notNull":
      case "defaultValue":
      case "primaryKey":
      case "generated":
      case "check":
        blocked.push(diff);
        blockedAttrs.push(key);
        break;
      case "unique":
        if (
          diff.type === "modify" &&
          (diff.value as unknown) === true &&
          (diff.prevValue as unknown) === false
        ) {
          promoteUnique = true;
        } else {
          blocked.push(diff);
          blockedAttrs.push("unique");
        }
        break;
      case "identity":
        subActions.push(...identitySubActions(diff));
        break;
    }
  }

  if (blocked.length > 0) {
    return {
      tableActions: [],
      operations: [],
      references: [],
      errors: [
        refusal({
          code: "IMMUTABLE_COLUMN",
          message:
            `Column "${columnName}" is immutable on existing tables — ` +
            `cannot change ${blockedAttrs.join(", ")}.`,
          object: blocked[0].object,
          subject: columnName,
          diffs: blocked,
        }),
      ],
    };
  }

  const tableActions: AnyAlterTableAction[] =
    subActions.length > 0 ? [ddl.alterColumn({ columnName, actions: subActions })] : [];

  const operations = promoteUnique
    ? uniquePromotionOps({
        tableName: ctx.tableName,
        tableNamespaceRef: ctx.tableNamespaceRef,
        indexName: uniqueIndexNameForColumn(ctx.local.name, columnName),
        constraintName: uniqueConstraintNameForColumn(ctx.local.name, columnName),
        columns: [columnName],
      })
    : [];

  return { tableActions, operations, references: [], errors: [] };
}

function processIndexDiffs(
  indexDiffs: Map<string, AnyDiff[]>,
  ctx: TableProcessingContext,
  options: DDLOperationOptions = { asyncIndexes: true, safeOperations: true }
): SubjectProcessingResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  for (const [indexName, diffsForIndex] of indexDiffs) {
    const wholeAdd = diffsForIndex.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForIndex.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForIndex.filter((d) => d.key !== undefined);

    if (wholeAdd) {
      operations.push(
        createIndexOperation(
          wholeAdd.object as IndexSerialized,
          ctx.tableName,
          options.safeOperations,
          options.asyncIndexes
        )
      );
      continue;
    }

    if (wholeRemove) {
      operations.push(dropIndexOperation(wholeRemove.object as IndexSerialized, options));
      continue;
    }

    if (attrDiffs.length > 0) {
      errors.push(
        refusal({
          code: "IMMUTABLE_INDEX",
          message:
            `Index "${indexName}" cannot be altered (${attrDiffs.map((d) => String(d.key)).join(", ")}). ` +
            `Drop and recreate the index explicitly.`,
          object: attrDiffs[0].object,
          subject: indexName,
          diffs: attrDiffs,
        })
      );
    }
  }

  return { operations, errors };
}

function processConstraintDiffs(
  constraintDiffs: Map<string, AnyDiff[]>,
  ctx: TableProcessingContext
): SubjectProcessingResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  for (const [constraintName, diffsForConstraint] of constraintDiffs) {
    const wholeAdd = diffsForConstraint.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForConstraint.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForConstraint.filter((d) => d.key !== undefined);

    if (wholeAdd) {
      const constraint = wholeAdd.object as ConstraintSerialized;
      if (constraint.kind === "UNIQUE_CONSTRAINT") {
        operations.push(
          ...uniquePromotionOps({
            tableName: ctx.tableName,
            tableNamespaceRef: ctx.tableNamespaceRef,
            indexName: uniqueIndexNameForConstraint(constraint.name),
            constraintName: constraint.name,
            columns: constraint.columns,
            include: constraint.include ?? undefined,
            nullsDistinct: constraint.distinctNulls ?? undefined,
            constraintObject: constraint,
          })
        );
        continue;
      }

      errors.push(
        refusal({
          code: "IMMUTABLE_CONSTRAINT",
          message:
            constraint.kind === "PRIMARY_KEY_CONSTRAINT"
              ? `Cannot add PRIMARY KEY "${constraintName}" to existing table — DSQL only allows PRIMARY KEY at CREATE TABLE.`
              : `Cannot add CHECK constraint "${constraintName}" to existing table — DSQL only allows CHECK at CREATE TABLE.`,
          object: constraint,
          subject: constraintName,
          diffs: [wholeAdd],
        })
      );
      continue;
    }

    if (wholeRemove || attrDiffs.length > 0) {
      const refusalDiffs = wholeRemove ? [wholeRemove] : attrDiffs;
      errors.push(
        refusal({
          code: "IMMUTABLE_CONSTRAINT",
          message: wholeRemove
            ? `Constraint "${constraintName}" cannot be dropped — constraints are immutable in DSQL.`
            : `Constraint "${constraintName}" cannot be modified — constraints are immutable in DSQL.`,
          object: refusalDiffs[0].object,
          subject: constraintName,
          diffs: refusalDiffs,
        })
      );
    }
  }

  return { operations, errors };
}

function nonPromotableInlineAttrs(column: ColumnSerialized): string[] {
  const blocked: string[] = [];
  if (column.notNull) blocked.push("NOT NULL");
  if (column.defaultValue !== null && column.defaultValue !== undefined) blocked.push("DEFAULT");
  if (column.check) blocked.push("CHECK");
  if (column.primaryKey) blocked.push("PRIMARY KEY");
  if (column.generated) blocked.push("GENERATED");
  return blocked;
}

function identitySubActions(diff: AnyDiff): AlterColumnSubAction[] {
  const value = diff.value as ColumnSerialized["identity"] | undefined;
  const prev = diff.prevValue as ColumnSerialized["identity"] | undefined;

  if (diff.type === "add" && value) {
    return [
      ddl.addIdentity({
        mode: value.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT",
        options: value.options ? sequenceOptionsFromIdentity(value.options) : undefined,
      }),
    ];
  }

  if (diff.type === "remove") {
    return [ddl.dropIdentity({ ifExists: true })];
  }

  if (diff.type === "modify" && value && prev) {
    const actions: AlterColumnSubAction[] = [];

    if (value.type !== prev.type) {
      actions.push(ddl.setGenerated({ mode: value.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT" }));
    }

    const startValue = value.options?.startValue;
    const prevStart = prev.options?.startValue;

    if (startValue !== undefined && startValue !== prevStart) {
      actions.push(ddl.restart({ with: startValue }));
    }

    return actions;
  }

  return [];
}

function sequenceOptionsFromIdentity(
  options: NonNullable<ColumnSerialized["identity"]>["options"]
) {
  if (!options) return undefined;
  return ddl.sequenceOptions({
    dataType: options.dataType,
    incrementBy: options.increment,
    cache: options.cache,
    cycle: options.cycle,
    startValue: options.startValue,
    minValue: options.minValue,
    maxValue: options.maxValue,
    ownedBy: options.ownedBy,
  });
}

function uniquePromotionOps(args: {
  tableName: string;
  tableNamespaceRef: string[];
  indexName: string;
  constraintName: string;
  columns: string[];
  include?: string[];
  nullsDistinct?: boolean;
  constraintObject?: ConstraintSerialized;
}): DDLOperation[] {
  const indexObject: IndexSerialized = {
    kind: "INDEX",
    name: args.indexName,
    unique: true,
    distinctNulls: args.nullsDistinct ?? null,
    columns: args.columns.map(
      (col) =>
        ({
          kind: "INDEX_COLUMN",
          name: `${args.indexName}_column_${col}`,
          sortDirection: "ASC",
          nulls: "LAST",
          column: col,
        }) as const
    ),
    include: args.include ?? null,
  } as IndexSerialized;

  const indexOp: DDLOperation = {
    type: "CREATE",
    object: indexObject,
    statement: ddl.createIndex({
      name: args.indexName,
      tableName: args.tableName,
      unique: true,
      async: true,
      columns: args.columns.map((col) => ddl.indexColumn({ columnName: col, nulls: "LAST" })),
      include: args.include,
      nullsDistinct: args.nullsDistinct,
      ifNotExists: true,
    }),
    references: [args.tableName, ...args.tableNamespaceRef],
  };

  const constraintObject: ConstraintSerialized =
    args.constraintObject ??
    ({
      kind: "UNIQUE_CONSTRAINT",
      name: args.constraintName,
      columns: args.columns,
      include: args.include ?? null,
      distinctNulls: args.nullsDistinct ?? null,
    } as ConstraintSerialized);

  const constraintOp: DDLOperation = {
    type: "CREATE",
    object: constraintObject,
    statement: ddl.alterTable({
      name: args.tableName,
      actions: [
        ddl.addConstraintUsingIndex({
          name: args.constraintName,
          kind: "UNIQUE",
          indexName: args.indexName,
        }),
      ],
    }),
    references: [args.tableName, args.indexName, ...args.tableNamespaceRef],
  };

  return [indexOp, constraintOp];
}
