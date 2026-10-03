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
  ColumnDefinitionExpression,
  IndexColumnExpression,
  TableConstraintExpression,
} from "../../ddl/ast.js";
import { ddl } from "../../ddl/index.js";
import { Diff, DiffType } from "../diffs/base.js";
import { diffTable } from "../diffs/table.js";
import {
  attributeChanges,
  change,
  DDLOperation,
  DDLOperationError,
  DDLOperationOptions,
  DEFAULT_DDL_OPERATION_OPTIONS,
  DraftOperation,
  kindMismatchError,
  maybeNamespaceReference,
  OperationResult,
  OperationSubject,
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

const tableSubject = (tableName: string): OperationSubject => ({ kind: "TABLE", name: tableName });

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
        identity: column.identity
          ? ddl.identity({
              mode: column.identity.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT",
              options: identitySequenceOptions(column.identity),
            })
          : undefined,
        generated: column.generated
          ? ddl.generated({ expression: column.generated.expression, stored: true })
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

  const [operation] = change(qualifiedName(object), [
    {
      type: "CREATE",
      object,
      statement,
      references,
      summary: { subject: tableSubject(qualifiedName(object)), action: "CREATE", risk: "safe" },
    },
  ]);
  return operation;
}

export function createIndexOperation(
  index: SerializedObject<AnyIndexDefinition>,
  tableName: string,
  ifNotExists = true,
  async = false
): DDLOperation {
  return change(`${tableName}.${index.name}`, [
    createIndexDraft(index, tableName, ifNotExists, async),
  ])[0];
}

function createIndexDraft(
  index: SerializedObject<AnyIndexDefinition>,
  tableName: string,
  ifNotExists: boolean,
  async: boolean
): DraftOperation {
  const references: string[] = maybeNamespaceReference(index) ?? [];
  references.push(tableName);

  const columns: IndexColumnExpression[] = index.columns.map((column) =>
    ddl.indexColumn({ columnName: column.column, nulls: column.nulls })
  );

  return {
    type: "CREATE",
    object: index,
    statement: ddl.createIndex({
      name: index.name,
      tableName,
      unique: index.unique,
      columns,
      include: index.include ?? undefined,
      nullsDistinct: index.distinctNulls,
      ifNotExists,
      async: async ? true : undefined,
    }),
    references,
    summary: {
      subject: tableSubject(tableName),
      action: "CREATE",
      target: { kind: "INDEX", name: index.name },
      changes: [
        {
          attribute: "columns",
          from: null,
          to: index.columns.map((column) => column.column).join(", "),
        },
      ],
      risk: "safe",
      async,
    },
  };
}

export function dropTableOperation(
  object: SerializedObject<AnyTableDefinition>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  // The domains its columns use: a domain dropped in the same plan must wait for the table.
  const domains = (object.columns as ColumnSerialized[]).flatMap((column) =>
    column.domain ? [column.domain] : []
  );

  return change(qualifiedName(object), [
    {
      type: "DROP",
      object,
      statement: ddl.dropTable({
        name: object.name,
        ifExists: options.ifExists,
        cascade: "RESTRICT",
      }),
      references: dedupe([...(maybeNamespaceReference(object) ?? []), ...domains]),
      summary: {
        subject: tableSubject(qualifiedName(object)),
        action: "DROP",
        risk: "destructive",
      },
    },
  ])[0];
}

export function dropIndexOperation(
  object: SerializedObject<AnyIndexDefinition>,
  tableName: string,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  return change(`${tableName}.${object.name}`, [
    {
      type: "DROP",
      object,
      statement: ddl.dropIndex({
        name: object.name,
        ifExists: options.ifExists,
        cascade: "RESTRICT",
      }),
      references: maybeNamespaceReference(object),
      summary: {
        subject: tableSubject(tableName),
        action: "DROP",
        target: { kind: "INDEX", name: object.name },
        risk: "lossy",
      },
    },
  ])[0];
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
    operations.push(createTableOperation(local, options.ifExists));

    for (const idx of local.indexes) {
      operations.push(createIndexOperation(idx, tableName, options.ifExists, options.asyncIndexes));
    }

    return { operations, errors };
  }

  if (remote.kind !== "TABLE") {
    errors.push(kindMismatchError("TABLE", remote));

    return { operations, errors };
  }

  const tableName = qualifiedName(local);
  const ctx: TableProcessingContext = {
    local,
    tableName,
    tableNamespaceRef: maybeNamespaceReference(local) ?? [],
    options,
  };

  const buckets = bucketDiffs(diffTable(local, remote) as unknown as AnyDiff[]);

  for (const result of [
    processColumnDiffs(buckets.columns, ctx),
    processIndexDiffs(buckets.indexes, ctx),
    processConstraintDiffs(buckets.constraints, ctx),
  ]) {
    operations.push(...result.operations);
    errors.push(...result.errors);
  }

  return { operations, errors };
}

type TableProcessingContext = {
  local: SerializedObject<AnyTableDefinition>;
  tableName: string;
  tableNamespaceRef: string[];
  options: DDLOperationOptions;
};

type SubjectProcessingResult = {
  operations: DDLOperation[];
  errors: DDLOperationError[];
};

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

/** One `ALTER TABLE` statement carrying exactly one action: a step of a column change. */
function alterTableDraft(
  ctx: TableProcessingContext,
  action: AnyAlterTableAction,
  summary: DraftOperation["summary"],
  references: string[] = []
): DraftOperation {
  return {
    type: "ALTER",
    object: ctx.local,
    statement: ddl.alterTable({ name: ctx.local.name, actions: [action] }),
    references: dedupe([...ctx.tableNamespaceRef, ...references]),
    summary,
  };
}

function processColumnDiffs(
  columnDiffs: Map<string, AnyDiff[]>,
  ctx: TableProcessingContext
): SubjectProcessingResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];

  for (const [columnName, diffsForColumn] of columnDiffs) {
    const wholeAdd = diffsForColumn.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForColumn.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForColumn.filter((d) => d.key !== undefined);
    const target = { kind: "COLUMN", name: columnName } as const;

    if (wholeRemove) {
      errors.push(
        refusal({
          code: "NO_DROP_COLUMN",
          message: `Column "${columnName}" cannot be dropped: DSQL does not support DROP COLUMN.`,
          object: wholeRemove.object,
          subject: columnName,
          diffs: [wholeRemove],
          summary: { subject: tableSubject(ctx.tableName), action: "DROP", target, changes: [] },
        })
      );
      continue;
    }

    const result = wholeAdd ? columnAdd(wholeAdd, ctx) : columnModify(columnName, attrDiffs, ctx);

    if ("error" in result) {
      errors.push(result.error);
    } else if (result.drafts.length > 0) {
      operations.push(...change(`${ctx.tableName}.${columnName}`, result.drafts));
    }
  }

  return { operations, errors };
}

type ColumnChange = { drafts: DraftOperation[] } | { error: DDLOperationError };

function columnAdd(diff: AnyDiff, ctx: TableProcessingContext): ColumnChange {
  const column = diff.object as ColumnSerialized;
  const blocked = nonPromotableInlineAttrs(column);
  const target = { kind: "COLUMN", name: column.name } as const;

  if (blocked.length > 0) {
    return {
      error: refusal({
        code: "IMMUTABLE_COLUMN",
        message:
          `Column "${column.name}" cannot be added with inline ${blocked.join(", ")}: ` +
          `DSQL only supports bare ADD COLUMN. Add the column without these attributes ` +
          `or recreate the table.`,
        object: column,
        subject: column.name,
        diffs: [diff],
        summary: {
          subject: tableSubject(ctx.tableName),
          action: "ADD",
          target,
          changes: [{ attribute: "dataType", from: null, to: column.dataType }],
        },
      }),
    };
  }

  const drafts: DraftOperation[] = [
    alterTableDraft(
      ctx,
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
      {
        subject: tableSubject(ctx.tableName),
        action: "ADD",
        target,
        changes: [{ attribute: "dataType", from: null, to: column.dataType }],
        risk: "safe",
      },
      column.domain ? [column.domain] : []
    ),
  ];

  if (column.identity) {
    drafts.push(
      alterTableDraft(
        ctx,
        ddl.alterColumn({
          columnName: column.name,
          actions: [
            ddl.addIdentity({
              mode: column.identity.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT",
              options: identitySequenceOptions(column.identity),
            }),
          ],
        }),
        {
          subject: tableSubject(ctx.tableName),
          action: "ADD",
          target: { kind: "IDENTITY", name: column.name },
          changes: [{ attribute: "identity", from: null, to: column.identity.type }],
          risk: "safe",
        }
      )
    );
  }

  if (column.unique) {
    drafts.push(
      ...uniquePromotionDrafts(ctx, {
        indexName: uniqueIndexNameForColumn(ctx.local.name, column.name),
        constraintName: uniqueConstraintNameForColumn(ctx.local.name, column.name),
        columns: [column.name],
      })
    );
  }

  return { drafts };
}

function columnModify(
  columnName: string,
  attrDiffs: AnyDiff[],
  ctx: TableProcessingContext
): ColumnChange {
  const blocked: AnyDiff[] = [];
  const drafts: DraftOperation[] = [];
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
        }
        break;
      case "identity":
        drafts.push(...identityDrafts(columnName, diff, ctx));
        break;
    }
  }

  if (blocked.length > 0) {
    return {
      error: refusal({
        code: "IMMUTABLE_COLUMN",
        message:
          `Column "${columnName}" is immutable on existing tables — ` +
          `cannot change ${blocked.map((diff) => String(diff.key)).join(", ")}.`,
        object: blocked[0].object,
        subject: columnName,
        diffs: blocked,
        summary: {
          subject: tableSubject(ctx.tableName),
          action: "ALTER",
          target: { kind: "COLUMN", name: columnName },
          changes: attributeChanges(blocked),
        },
      }),
    };
  }

  if (promoteUnique) {
    drafts.push(
      ...uniquePromotionDrafts(ctx, {
        indexName: uniqueIndexNameForColumn(ctx.local.name, columnName),
        constraintName: uniqueConstraintNameForColumn(ctx.local.name, columnName),
        columns: [columnName],
      })
    );
  }

  return { drafts };
}

function processIndexDiffs(
  indexDiffs: Map<string, AnyDiff[]>,
  ctx: TableProcessingContext
): SubjectProcessingResult {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  const { options } = ctx;

  for (const [indexName, diffsForIndex] of indexDiffs) {
    const wholeAdd = diffsForIndex.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForIndex.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForIndex.filter((d) => d.key !== undefined);

    if (wholeAdd) {
      operations.push(
        createIndexOperation(
          wholeAdd.object as IndexSerialized,
          ctx.tableName,
          options.ifExists,
          options.asyncIndexes
        )
      );
      continue;
    }

    if (wholeRemove) {
      operations.push(
        dropIndexOperation(wholeRemove.object as IndexSerialized, ctx.tableName, options)
      );
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
          summary: {
            subject: tableSubject(ctx.tableName),
            action: "ALTER",
            target: { kind: "INDEX", name: indexName },
            changes: attributeChanges(attrDiffs),
          },
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
    const target = { kind: "CONSTRAINT", name: constraintName } as const;
    const subject = tableSubject(ctx.tableName);

    if (wholeAdd) {
      const constraint = wholeAdd.object as ConstraintSerialized;
      if (constraint.kind === "UNIQUE_CONSTRAINT") {
        operations.push(
          ...change(
            `${ctx.tableName}.${constraint.name}`,
            uniquePromotionDrafts(ctx, {
              indexName: uniqueIndexNameForConstraint(constraint.name),
              constraintName: constraint.name,
              columns: constraint.columns,
              include: constraint.include ?? undefined,
              nullsDistinct: constraint.distinctNulls ?? undefined,
              constraintObject: constraint,
            })
          )
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
          summary: { subject, action: "ADD", target, changes: [] },
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
          summary: {
            subject,
            action: wholeRemove ? "DROP" : "ALTER",
            target,
            changes: attributeChanges(refusalDiffs),
          },
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

/** The steps an identity difference takes: one `ALTER COLUMN` action each. */
function identityDrafts(
  columnName: string,
  diff: AnyDiff,
  ctx: TableProcessingContext
): DraftOperation[] {
  const value = diff.value as ColumnSerialized["identity"] | undefined;
  const prev = diff.prevValue as ColumnSerialized["identity"] | undefined;
  const target = { kind: "IDENTITY", name: columnName } as const;
  const subject = tableSubject(ctx.tableName);

  const draft = (
    action: Parameters<typeof ddl.alterColumn>[0]["actions"][number],
    summary: Omit<DraftOperation["summary"], "subject" | "target">
  ) =>
    alterTableDraft(ctx, ddl.alterColumn({ columnName, actions: [action] }), {
      subject,
      target,
      ...summary,
    });

  if (diff.type === "add" && value) {
    return [
      draft(
        ddl.addIdentity({
          mode: value.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT",
          options: identitySequenceOptions(value),
        }),
        {
          action: "ADD",
          changes: [{ attribute: "identity", from: null, to: value.type }],
          risk: "safe",
        }
      ),
    ];
  }

  if (diff.type === "remove") {
    return [
      draft(ddl.dropIdentity({ ifExists: true }), {
        action: "DROP",
        changes: [{ attribute: "identity", from: prev?.type ?? null, to: null }],
        risk: "lossy",
      }),
    ];
  }

  if (diff.type === "modify" && value && prev) {
    const drafts: DraftOperation[] = [];

    if (value.type !== prev.type) {
      drafts.push(
        draft(ddl.setGenerated({ mode: value.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT" }), {
          action: "ALTER",
          changes: [{ attribute: "identity", from: prev.type, to: value.type }],
          risk: "safe",
        })
      );
    }

    const startValue = value.options?.startValue;
    const prevStart = prev.options?.startValue;

    if (startValue !== undefined && startValue !== prevStart) {
      // Restarting can hand out values already used: lossy until the definition's
      // `startValue` maps to `SET START` instead (column policy story).
      drafts.push(
        draft(ddl.restart({ with: startValue }), {
          action: "ALTER",
          changes: [{ attribute: "startValue", from: prevStart ?? null, to: startValue }],
          risk: "lossy",
        })
      );
    }

    return drafts;
  }

  return [];
}

/** An identity's sequence options, named `SEQUENCE NAME` when the definition names it. */
function identitySequenceOptions(identity: NonNullable<ColumnSerialized["identity"]>) {
  const { options, sequenceName } = identity;

  if (!options && !sequenceName) return undefined;

  return ddl.sequenceOptions({
    sequenceName: sequenceName ?? undefined,
    dataType: options?.dataType,
    incrementBy: options?.increment,
    cache: options?.cache,
    cycle: options?.cycle,
    startValue: options?.startValue,
    minValue: options?.minValue,
    maxValue: options?.maxValue,
    ownedBy: options?.ownedBy,
  });
}

function uniquePromotionDrafts(
  ctx: TableProcessingContext,
  args: {
    indexName: string;
    constraintName: string;
    columns: string[];
    include?: string[];
    nullsDistinct?: boolean;
    constraintObject?: ConstraintSerialized;
  }
): DraftOperation[] {
  const { tableName, tableNamespaceRef, options } = ctx;
  const subject = tableSubject(tableName);

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
          nulls: "LAST",
          column: col,
        }) as const
    ),
    include: args.include ?? null,
  } as IndexSerialized;

  const indexDraft: DraftOperation = {
    type: "CREATE",
    object: indexObject,
    statement: ddl.createIndex({
      name: args.indexName,
      tableName,
      unique: true,
      async: options.asyncIndexes ? true : undefined,
      columns: args.columns.map((col) => ddl.indexColumn({ columnName: col, nulls: "LAST" })),
      include: args.include,
      nullsDistinct: args.nullsDistinct,
      ifNotExists: true,
    }),
    references: [tableName, ...tableNamespaceRef],
    summary: {
      subject,
      action: "CREATE",
      target: { kind: "INDEX", name: args.indexName },
      changes: [{ attribute: "columns", from: null, to: args.columns.join(", ") }],
      risk: "safe",
      async: options.asyncIndexes,
      note: "unique index for the constraint that follows",
    },
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

  const constraintDraft: DraftOperation = {
    type: "CREATE",
    object: constraintObject,
    statement: ddl.alterTable({
      name: tableName,
      actions: [
        ddl.addConstraintUsingIndex({
          name: args.constraintName,
          kind: "UNIQUE",
          indexName: args.indexName,
        }),
      ],
    }),
    references: [tableName, args.indexName, ...tableNamespaceRef],
    summary: {
      subject,
      action: "ADD",
      target: { kind: "CONSTRAINT", name: args.constraintName },
      changes: [{ attribute: "unique", from: null, to: args.columns.join(", ") }],
      risk: "safe",
    },
  };

  return [indexDraft, constraintDraft];
}
