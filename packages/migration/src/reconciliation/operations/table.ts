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
import { columnUniqueName, diffTable } from "../diffs/table.js";
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
  return change(`${tableName}.${object.name}`, [dropIndexDraft(object, tableName, options)])[0];
}

function dropIndexDraft(
  object: SerializedObject<AnyIndexDefinition>,
  tableName: string,
  options: DDLOperationOptions
): DraftOperation {
  return {
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

  const columnResult = processColumnDiffs(buckets.columns, ctx);

  // A refused column's CHECK or UNIQUE would land on a column that never gets added.
  for (const column of local.columns as ColumnSerialized[]) {
    if (columnResult.refused.has(column.name)) {
      if (column.check) buckets.constraints.delete(column.check.name);
      if (column.unique) buckets.constraints.delete(columnUniqueName(local.name, column.name));
    }
  }

  for (const result of [
    columnResult,
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
): SubjectProcessingResult & { refused: Set<string> } {
  const operations: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  const refused = new Set<string>();

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
      refused.add(columnName);
    } else if (result.drafts.length > 0) {
      operations.push(...change(`${ctx.tableName}.${columnName}`, result.drafts));
    }
  }

  return { operations, errors, refused };
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

  return { drafts };
}

function columnModify(
  columnName: string,
  attrDiffs: AnyDiff[],
  ctx: TableProcessingContext
): ColumnChange {
  const blocked: AnyDiff[] = [];
  const drafts: DraftOperation[] = [];

  for (const diff of attrDiffs) {
    const key = diff.key as string;
    switch (key) {
      case "dataType":
      case "domain":
      case "notNull":
      case "defaultValue":
      case "generated":
        blocked.push(diff);
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

  return { drafts };
}

type CheckSerialized = { name: string; expression: string; validated?: boolean };

/**
 * A CHECK on an existing table: added `NOT VALID` — DSQL accepts no other form, and it is
 * enforced on new writes at once — then validated against the existing rows as an async job.
 */
function addCheckDrafts(ctx: TableProcessingContext, check: CheckSerialized): DraftOperation[] {
  return [
    alterTableDraft(
      ctx,
      ddl.addConstraint({
        constraint: ddl.check({ name: check.name, expression: check.expression }),
        notValid: true,
      }),
      {
        subject: tableSubject(ctx.tableName),
        action: "ADD",
        target: { kind: "CONSTRAINT", name: check.name },
        changes: [{ attribute: "check", from: null, to: check.expression }],
        risk: "safe",
        note: "enforced on new writes at once; existing rows are checked by the next step",
      }
    ),
    validateConstraintDraft(ctx, check.name),
  ];
}

function validateConstraintDraft(ctx: TableProcessingContext, name: string): DraftOperation {
  return {
    type: "ALTER",
    object: ctx.local,
    statement: ddl.alterTable({
      name: ctx.local.name,
      async: ctx.options.asyncIndexes ? true : undefined,
      actions: [ddl.validateConstraint({ name })],
    }),
    references: dedupe(ctx.tableNamespaceRef),
    summary: {
      subject: tableSubject(ctx.tableName),
      action: "VALIDATE",
      target: { kind: "CONSTRAINT", name },
      risk: "safe",
      async: ctx.options.asyncIndexes,
      note: "fails if an existing row violates it; the constraint stays, not valid",
    },
  };
}

/** `DROP CONSTRAINT`: a CHECK, or a UNIQUE together with its index. Lossy. */
function dropConstraintDraft(ctx: TableProcessingContext, name: string): DraftOperation {
  return alterTableDraft(
    ctx,
    ddl.dropConstraint({ name, ifExists: ctx.options.ifExists, cascade: "RESTRICT" }),
    {
      subject: tableSubject(ctx.tableName),
      action: "DROP",
      target: { kind: "CONSTRAINT", name },
      risk: "lossy",
    }
  );
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
      // An index can't be altered: it is rebuilt. Also how an index whose async build failed
      // (`valid: false`) is repaired.
      const local = attrDiffs[0].object as IndexSerialized;

      operations.push(
        ...change(`${ctx.tableName}.${indexName}`, [
          dropIndexDraft(local, ctx.tableName, options),
          {
            ...createIndexDraft(local, ctx.tableName, options.ifExists, options.asyncIndexes),
            summary: {
              ...createIndexDraft(local, ctx.tableName, options.ifExists, options.asyncIndexes)
                .summary,
              changes: attributeChanges(attrDiffs),
              note: "rebuild: the index is unavailable until this step completes",
            },
          },
        ])
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
    const constraint = (wholeAdd ?? wholeRemove ?? attrDiffs[0])?.object as ConstraintSerialized;
    const key = `${ctx.tableName}.${constraintName}`;

    if (constraint.kind === "PRIMARY_KEY_CONSTRAINT") {
      const diffs = wholeAdd ? [wholeAdd] : wholeRemove ? [wholeRemove] : attrDiffs;

      errors.push(
        refusal({
          code: "IMMUTABLE_CONSTRAINT",
          message:
            `Primary key "${constraintName}" can't be ${wholeAdd ? "added" : wholeRemove ? "dropped" : "changed"}: ` +
            `DSQL sets a table's primary key when the table is created, and it can't change after.`,
          object: constraint,
          subject: constraintName,
          diffs,
          summary: {
            subject: tableSubject(ctx.tableName),
            action: wholeAdd ? "ADD" : wholeRemove ? "DROP" : "ALTER",
            target: { kind: "CONSTRAINT", name: constraintName },
            changes: attributeChanges(diffs),
          },
        })
      );
      continue;
    }

    if (wholeRemove) {
      operations.push(...change(key, [dropConstraintDraft(ctx, constraintName)]));
      continue;
    }

    const promotion = (unique: AnyUniqueConstraint) =>
      uniquePromotionDrafts(ctx, {
        indexName: uniqueIndexNameForConstraint(unique.name),
        constraintName: unique.name,
        columns: unique.columns,
        include: unique.include ?? undefined,
        nullsDistinct: unique.distinctNulls ?? undefined,
        constraintObject: unique,
      });

    if (wholeAdd) {
      operations.push(
        ...change(
          key,
          constraint.kind === "UNIQUE_CONSTRAINT"
            ? promotion(constraint)
            : addCheckDrafts(ctx, constraint as CheckSerialized)
        )
      );
      continue;
    }

    if (attrDiffs.every((diff) => String(diff.key) === "validated")) {
      operations.push(...change(key, [validateConstraintDraft(ctx, constraintName)]));
      continue;
    }

    // A changed UNIQUE: dropped (its index with it), then built and promoted again.
    if (constraint.kind === "UNIQUE_CONSTRAINT") {
      operations.push(
        ...change(key, [dropConstraintDraft(ctx, constraintName), ...promotion(constraint)])
      );
    }
  }

  return { operations, errors };
}

type AnyUniqueConstraint = Extract<ConstraintSerialized, { kind: "UNIQUE_CONSTRAINT" }>;

function nonPromotableInlineAttrs(column: ColumnSerialized): string[] {
  const blocked: string[] = [];
  if (column.notNull) blocked.push("NOT NULL");
  if (column.defaultValue !== null && column.defaultValue !== undefined) blocked.push("DEFAULT");
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
