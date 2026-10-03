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
import {
  columnUniqueName,
  diffTable,
  namedConstraintsOf,
  notNullCheckName,
  notNullChecksOf,
  primaryKeyOf,
} from "../diffs/table.js";
import { changedSequenceOptions, effectiveSequenceOptions } from "../diffs/sequence.js";
import { renameColumns } from "./rename.js";
import {
  attributeChanges,
  AttributeChange,
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
  deriveIdentifier,
  qualifiedName,
  schemaOf,
  refusal,
  RefusalCode,
} from "./base.js";

type ColumnSerialized = SerializedObject<AnyColumnDefinition>;
type IndexSerialized = SerializedObject<AnyIndexDefinition>;
type ConstraintSerialized = SerializedObject<AnyConstraintDefinition>;
type AnyDiff = Diff<DiffType, SerializedObject<DefinitionNode>>;

/** The index a UNIQUE is built on before it is promoted to the constraint. */
const uniqueIndexNameForConstraint = (constraint: string) => deriveIdentifier(constraint, "idx");

/** The index a changed index is rebuilt under, beside the current one, before the swap. */
const rebuildIndexName = (index: string) => deriveIdentifier(index, "rebuild");

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
    schema: schemaOf(object),
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
  table: SerializedObject<AnyTableDefinition>,
  ifNotExists = true,
  async = false
): DDLOperation {
  return change(`${qualifiedName(table)}.${index.name}`, [
    createIndexDraft(index, table, ifNotExists, async),
  ])[0];
}

function createIndexDraft(
  index: SerializedObject<AnyIndexDefinition>,
  table: SerializedObject<AnyTableDefinition>,
  ifNotExists: boolean,
  async: boolean
): DraftOperation {
  const tableName = qualifiedName(table);
  const references: string[] = maybeNamespaceReference(index) ?? [];
  references.push(tableName);

  const columns: IndexColumnExpression[] = index.columns.map((column) =>
    ddl.indexColumn({
      columnName: column.column ?? "",
      expression: "expression" in column ? column.expression : undefined,
      nulls: column.nulls,
    })
  );

  return {
    type: "CREATE",
    object: index,
    statement: ddl.createIndex({
      name: index.name,
      tableName: table.name,
      tableSchema: schemaOf(table),
      unique: index.unique,
      columns,
      include: index.include ?? undefined,
      nullsDistinct: index.distinctNulls,
      where: index.where ?? undefined,
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
          to: index.columns
            .map(
              (column) => column.column ?? ("expression" in column ? `(${column.expression})` : "")
            )
            .join(", "),
        },
        ...(index.where ? [{ attribute: "where", from: null, to: index.where }] : []),
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
        schema: schemaOf(object),
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

/**
 * An index in the database the definition doesn't declare. Without a history the runner can't
 * tell one removed from the definition from one made by hand, so the note names both.
 */
export function dropIndexOperation(
  object: SerializedObject<AnyIndexDefinition>,
  table: SerializedObject<AnyTableDefinition>,
  options: DDLOperationOptions = DEFAULT_DDL_OPERATION_OPTIONS
): DDLOperation {
  const draft = dropIndexDraft(object, table, options);

  return change(`${qualifiedName(table)}.${object.name}`, [
    {
      ...draft,
      summary: {
        ...draft.summary,
        note: "not in the definition: removed from it, or created outside it",
      },
    },
  ])[0];
}

function dropIndexDraft(
  object: SerializedObject<AnyIndexDefinition>,
  table: SerializedObject<AnyTableDefinition>,
  options: DDLOperationOptions
): DraftOperation {
  return {
    type: "DROP",
    object,
    statement: ddl.dropIndex({
      name: object.name,
      // An index lives in its table's schema.
      schema: schemaOf(table),
      ifExists: options.ifExists,
      cascade: "RESTRICT",
    }),
    references: maybeNamespaceReference(object),
    summary: {
      subject: tableSubject(qualifiedName(table)),
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
    operations.push(createTableOperation(local, options.ifExists));

    for (const idx of local.indexes) {
      operations.push(createIndexOperation(idx, local, options.ifExists, options.asyncIndexes));
    }

    return { operations, errors };
  }

  if (remote.kind !== "TABLE") {
    errors.push(kindMismatchError("TABLE", remote));

    return { operations, errors };
  }

  const tableName = qualifiedName(local);

  // Columns renamed with `renamedFrom` are renamed first; the rest is diffed against the table
  // as it will be then.
  const renamed = renameColumns(local, remote);
  remote = renamed.remote;
  operations.push(...renamed.operations);
  errors.push(...renamed.errors);

  const ctx: TableProcessingContext = {
    local,
    tableName,
    schema: schemaOf(local),
    tableNamespaceRef: maybeNamespaceReference(local) ?? [],
    options,
    remoteColumns: new Map((remote.columns as ColumnSerialized[]).map((c) => [c.name, c])),
    remoteNotNull: notNullChecksOf(remote),
    remoteKey: primaryKeyOf(remote)?.columns ?? [],
    keyColumns: primaryKeyOf(local)?.columns ?? [],
    leftoverIndexes: leftoverIndexesOf(local, remote),
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

  operations.push(...columnResult.drops);

  // Leftovers no rebuild or promotion needed: their names are free, and they cost writes.
  for (const leftover of ctx.leftoverIndexes.values()) {
    const draft = dropIndexDraft(leftover, local, options);

    operations.push(
      ...change(`${tableName}.${leftover.name}`, [
        {
          ...draft,
          summary: { ...draft.summary, note: "left by an earlier run that stopped part-way" },
        },
      ])
    );
  }

  return { operations, errors };
}

/** See {@link TableProcessingContext.leftoverIndexes}. */
function leftoverIndexesOf(
  local: SerializedObject<AnyTableDefinition>,
  remote: SerializedObject<AnyTableDefinition>
): Map<string, IndexSerialized> {
  const declared = new Set(local.indexes.map((index) => index.name));
  const derived = new Set([
    ...local.indexes.map((index) => rebuildIndexName(index.name)),
    ...namedConstraintsOf(local)
      .filter((constraint) => constraint.kind === "UNIQUE_CONSTRAINT")
      .map((constraint) => uniqueIndexNameForConstraint(constraint.name)),
  ]);

  return new Map(
    (remote.indexes as IndexSerialized[])
      .filter((index) => derived.has(index.name) && !declared.has(index.name))
      .map((index) => [index.name, index])
  );
}

/** The step dropping a leftover under `name`, if there is one; it is no longer swept after. */
function takeLeftover(ctx: TableProcessingContext, name: string): DraftOperation[] {
  const leftover = ctx.leftoverIndexes.get(name);
  if (!leftover) return [];

  ctx.leftoverIndexes.delete(name);
  const draft = dropIndexDraft(leftover, ctx.local, ctx.options);

  return [
    {
      ...draft,
      summary: { ...draft.summary, note: "left by an earlier run that stopped part-way" },
    },
  ];
}

type TableProcessingContext = {
  local: SerializedObject<AnyTableDefinition>;
  tableName: string;
  /** The table's schema outside `public`: every statement on the table is qualified with it. */
  schema: string | undefined;
  tableNamespaceRef: string[];
  options: DDLOperationOptions;
  /** The database's columns, as introspected. */
  remoteColumns: Map<string, ColumnSerialized>;
  /** The database's NOT NULLs enforced by a CHECK, by column. */
  remoteNotNull: Map<string, { name: string }>;
  /** The database's primary-key columns. */
  remoteKey: readonly string[];
  /** The definition's primary-key columns, which backfill batches are picked by. */
  keyColumns: readonly string[];
  /**
   * Indexes in the database under a name the planner builds with (a rebuild, a UNIQUE's index)
   * that an earlier run left behind when it stopped part-way. Each is dropped before its name is
   * built again; {@link takeLeftover} hands it to the step that does, and whatever is left is
   * dropped on its own.
   */
  leftoverIndexes: Map<string, IndexSerialized>;
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
    statement: ddl.alterTable({ name: ctx.local.name, schema: ctx.schema, actions: [action] }),
    references: dedupe([...ctx.tableNamespaceRef, ...references]),
    summary,
  };
}

/** The comment `deprecated()` leaves on a column: introspection reads it back. */
const DEPRECATED_MARKER = "dsqlbase:deprecated";

/** Rows per backfill batch: well inside DSQL's 3,000 rows written per transaction. */
const BACKFILL_BATCH_SIZE = 1000;

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

function processColumnDiffs(
  columnDiffs: Map<string, AnyDiff[]>,
  ctx: TableProcessingContext
): SubjectProcessingResult & { refused: Set<string>; drops: DDLOperation[] } {
  const operations: DDLOperation[] = [];
  const drops: DDLOperation[] = [];
  const errors: DDLOperationError[] = [];
  const refused = new Set<string>();

  const added = [...columnDiffs.values()].flatMap((diffs) =>
    diffs.filter((d) => d.type === "add" && !d.key).map((d) => d.name)
  );

  for (const [columnName, diffsForColumn] of columnDiffs) {
    const wholeAdd = diffsForColumn.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForColumn.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForColumn.filter((d) => d.key !== undefined);

    const result = wholeRemove
      ? columnDrop(columnName, wholeRemove, ctx, added)
      : wholeAdd
        ? columnAdd(wholeAdd.object as ColumnSerialized, ctx, [wholeAdd])
        : columnModify(columnName, attrDiffs, ctx);

    if ("error" in result) {
      errors.push(result.error);
      refused.add(columnName);
    } else if (result.drafts.length > 0) {
      // Drops run after the table's index and constraint changes, which may involve the column.
      (wholeRemove ? drops : operations).push(
        ...change(`${ctx.tableName}.${columnName}`, result.drafts)
      );
    }
  }

  return { operations, errors, refused, drops };
}

type ColumnChange = { drafts: DraftOperation[] } | { error: DDLOperationError };

/** A refused column change, described for the report. */
function refuseColumn(
  ctx: TableProcessingContext,
  args: {
    code: RefusalCode;
    message: string;
    column: string;
    action: DraftOperation["summary"]["action"];
    diffs: AnyDiff[];
    changes?: AttributeChange[];
  }
): ColumnChange {
  return {
    error: refusal({
      code: args.code,
      message: args.message,
      object: args.diffs[0]?.object ?? ctx.local,
      subject: args.column,
      diffs: args.diffs,
      summary: {
        subject: tableSubject(ctx.tableName),
        action: args.action,
        target: { kind: "COLUMN", name: args.column },
        changes: args.changes ?? attributeChanges(args.diffs),
      },
    }),
  };
}

/** One `ALTER COLUMN` action as its own statement. */
function alterColumnDraft(
  ctx: TableProcessingContext,
  columnName: string,
  action: Parameters<typeof ddl.alterColumn>[0]["actions"][number],
  summary: Omit<DraftOperation["summary"], "subject">
): DraftOperation {
  return alterTableDraft(ctx, ddl.alterColumn({ columnName, actions: [action] }), {
    subject: tableSubject(ctx.tableName),
    ...summary,
  });
}

/**
 * A column added to an existing table. DSQL's `ADD COLUMN` takes no attributes at all, so each
 * becomes a step of its own: the default, and for NOT NULL a backfill and a CHECK. The column's
 * other CHECKs and its UNIQUE come from the table's constraint diff.
 */
function columnAdd(
  column: ColumnSerialized,
  ctx: TableProcessingContext,
  diffs: AnyDiff[]
): ColumnChange {
  const refuse = (code: RefusalCode, message: string) =>
    refuseColumn(ctx, {
      code,
      message,
      column: column.name,
      action: "ADD",
      diffs,
      changes: [{ attribute: "dataType", from: null, to: column.dataType }],
    });

  if (column.generated) {
    return refuse(
      "NO_ADD_GENERATED_COLUMN",
      `Column "${column.name}" can't be added as a generated column: DSQL can't add one to an ` +
        `existing table. Add it as a plain column the application fills, or create the table ` +
        `with it.`
    );
  }

  if (column.identity) {
    return refuse(
      "NO_ADD_IDENTITY",
      `Column "${column.name}" can't be added as an identity: an identity column must be NOT ` +
        `NULL before it is made one, and DSQL can't make an existing column NOT NULL. Use a ` +
        `sequence default (\`nextval\`) instead, or create the table with it.`
    );
  }

  if (column.notNull && column.defaultValue == null) {
    return refuse(
      "NOT_NULL_NEEDS_DEFAULT",
      `Column "${column.name}" can't be added NOT NULL without a default: its existing rows ` +
        `would be NULL. Give it a default — existing rows are filled with it — or add it nullable.`
    );
  }

  const drafts: DraftOperation[] = [
    alterTableDraft(
      ctx,
      ddl.addColumn({
        ifNotExists: ctx.options.ifExists,
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
        target: { kind: "COLUMN", name: column.name },
        changes: [{ attribute: "dataType", from: null, to: column.dataType }],
        risk: "safe",
      },
      column.domain ? [column.domain] : []
    ),
  ];

  if (column.defaultValue != null) {
    drafts.push(
      setDefaultDraft(ctx, column.name, column.defaultValue, null, {
        note: column.notNull
          ? undefined
          : "applies to new rows; existing rows stay NULL (DSQL's ADD COLUMN takes no DEFAULT)",
      })
    );
  }

  if (column.notNull) {
    drafts.push(...notNullDrafts(ctx, column.name, true));
  }

  return { drafts };
}

function setDefaultDraft(
  ctx: TableProcessingContext,
  columnName: string,
  value: string,
  previous: string | null,
  extra: { note?: string } = {}
): DraftOperation {
  return alterColumnDraft(ctx, columnName, ddl.setDefault({ expression: value }), {
    action: previous == null ? "ADD" : "ALTER",
    target: { kind: "DEFAULT", name: columnName },
    changes: [{ attribute: "defaultValue", from: previous, to: value }],
    risk: "safe",
    note: extra.note,
  });
}

/**
 * NOT NULL on an existing column, as DSQL allows it: with a default, a backfill fills the NULLs
 * with it; then `CHECK (c IS NOT NULL)` is added `NOT VALID` and validated. Without a default,
 * validation fails if a NULL is left — as `SET NOT NULL` would.
 */
function notNullDrafts(
  ctx: TableProcessingContext,
  columnName: string,
  hasDefault: boolean
): DraftOperation[] {
  const drafts: DraftOperation[] = [];

  if (hasDefault) {
    drafts.push({
      type: "ALTER",
      object: ctx.local,
      statement: ddl.backfill({
        tableName: ctx.local.name,
        schema: ctx.schema,
        columnName,
        key: [...ctx.keyColumns],
        batchSize: BACKFILL_BATCH_SIZE,
      }),
      references: dedupe(ctx.tableNamespaceRef),
      summary: {
        subject: tableSubject(ctx.tableName),
        action: "BACKFILL",
        target: { kind: "COLUMN", name: columnName },
        changes: [{ attribute: "NULLs", from: null, to: "default" }],
        risk: "safe",
        note: `fills NULLs with the default, ${BACKFILL_BATCH_SIZE} rows per transaction; long on large tables`,
      },
    });
  }

  const [add, validate] = addCheckDrafts(ctx, {
    name: notNullCheckName(ctx.local.name, columnName),
    expression: `${quoteIdentifier(columnName)} IS NOT NULL`,
  });

  return [
    ...drafts,
    {
      ...add,
      summary: {
        ...add.summary,
        changes: [{ attribute: "notNull", from: false, to: true }],
        note: "NOT NULL as a CHECK: DSQL has no SET NOT NULL",
      },
    },
    hasDefault
      ? validate
      : {
          ...validate,
          summary: {
            ...validate.summary,
            note: "fails if a row is NULL: give the column a default to fill them",
          },
        },
  ];
}

function columnModify(
  columnName: string,
  attrDiffs: AnyDiff[],
  ctx: TableProcessingContext
): ColumnChange {
  const local = (ctx.local.columns as ColumnSerialized[]).find((c) => c.name === columnName);
  const remote = ctx.remoteColumns.get(columnName);
  const diffOf = (key: string) => attrDiffs.find((diff) => diff.key === key);

  if (!local || !remote) {
    return { drafts: [] };
  }

  if (diffOf("dataType") || diffOf("domain")) {
    return typeChange(local, remote, attrDiffs, ctx);
  }

  const drafts: DraftOperation[] = [];
  const generated = diffOf("generated");

  if (generated) {
    if (!remote.generated || local.generated) {
      return refuseColumn(ctx, {
        code: "NO_ALTER_GENERATED",
        message:
          `Column "${columnName}" can't ${remote.generated ? "change its expression" : "become generated"}: ` +
          `DSQL can't add or change a generated column on an existing table. Add a new column, ` +
          `or create the table with it.`,
        column: columnName,
        action: "ALTER",
        diffs: [generated],
      });
    }

    drafts.push(
      alterColumnDraft(ctx, columnName, ddl.dropExpression(), {
        action: "DROP",
        target: { kind: "COLUMN", name: columnName },
        changes: [{ attribute: "generated", from: remote.generated.expression, to: null }],
        risk: "destructive",
        note: "keeps the values but stops computing them; DSQL can't make the column generated again",
      })
    );
  }

  const defaultValue = diffOf("defaultValue");

  if (defaultValue) {
    drafts.push(
      local.defaultValue == null
        ? alterColumnDraft(ctx, columnName, ddl.dropDefault(), {
            action: "DROP",
            target: { kind: "DEFAULT", name: columnName },
            changes: [{ attribute: "defaultValue", from: remote.defaultValue, to: null }],
            risk: "lossy",
          })
        : setDefaultDraft(ctx, columnName, local.defaultValue, remote.defaultValue ?? null)
    );
  }

  const notNull = diffOf("notNull");

  if (notNull && local.notNull) {
    drafts.push(...notNullDrafts(ctx, columnName, local.defaultValue != null));
  } else if (notNull) {
    const check = ctx.remoteNotNull.get(columnName);

    drafts.push(
      check
        ? {
            ...dropConstraintDraft(ctx, check.name),
            summary: {
              ...dropConstraintDraft(ctx, check.name).summary,
              changes: [{ attribute: "notNull", from: true, to: false }],
            },
          }
        : alterColumnDraft(ctx, columnName, ddl.dropNotNull(), {
            action: "DROP",
            target: { kind: "COLUMN", name: columnName },
            changes: [{ attribute: "notNull", from: true, to: false }],
            risk: "lossy",
          })
    );
  }

  const deprecated = diffOf("deprecated");

  if (deprecated) {
    // The marker is how a later release knows the drop was planned: the runner keeps no
    // history of its own.
    drafts.push({
      type: "ALTER",
      object: ctx.local,
      statement: ddl.commentOnColumn({
        tableName: ctx.local.name,
        schema: ctx.schema,
        columnName,
        comment: local.deprecated ? DEPRECATED_MARKER : null,
      }),
      references: dedupe(ctx.tableNamespaceRef),
      summary: {
        subject: tableSubject(ctx.tableName),
        action: "ALTER",
        target: { kind: "COLUMN", name: columnName },
        changes: [{ attribute: "deprecated", from: !local.deprecated, to: local.deprecated }],
        risk: "safe",
        note: local.deprecated
          ? "hidden from the client; remove it from the definition in a later release to drop it"
          : undefined,
      },
    });
  }

  const identity = diffOf("identity");

  if (identity) {
    const result = identityDrafts(columnName, identity, remote, ctx);
    if ("error" in result) return result;
    drafts.push(...result.drafts);
  }

  return { drafts };
}

/**
 * A type change. DSQL has no `SET DATA TYPE`, so the column is dropped and added again — its
 * data is lost, which makes the change destructive. DSQL drops the column's indexes and
 * constraints with it; they're created again after.
 */
function typeChange(
  local: ColumnSerialized,
  remote: ColumnSerialized,
  diffs: AnyDiff[],
  ctx: TableProcessingContext
): ColumnChange {
  const from = remote.domain ?? remote.dataType;
  const to = local.domain ?? local.dataType;

  if (ctx.remoteKey.includes(local.name)) {
    return refuseColumn(ctx, {
      code: "NO_ALTER_PRIMARY_KEY_COLUMN",
      message:
        `Column "${local.name}" can't change from ${from} to ${to}: it's part of the primary key, ` +
        `which DSQL can't drop or change.`,
      column: local.name,
      action: "ALTER",
      diffs,
    });
  }

  const add = columnAdd(local, ctx, diffs);

  if ("error" in add) {
    return {
      error: {
        ...add.error,
        message: `Changing "${local.name}" from ${from} to ${to} drops and adds it again; ${add.error.message}`,
      },
    };
  }

  const drop = alterTableDraft(
    ctx,
    ddl.dropColumn({ columnName: local.name, ifExists: ctx.options.ifExists }),
    {
      subject: tableSubject(ctx.tableName),
      action: "DROP",
      target: { kind: "COLUMN", name: local.name },
      changes: [{ attribute: "dataType", from, to }],
      risk: "destructive",
      note:
        `type change: DSQL has no SET DATA TYPE, so the column is dropped and added again and ` +
        `its data is lost. To keep it, add "${local.name}_v2" as ${to}, copy the values, switch ` +
        `the code, then .deprecated() "${local.name}" and remove it in a later release.`,
    }
  );

  return { drafts: [drop, ...add.drafts, ...recreateDrafts(local.name, ctx)] };
}

/** The indexes and constraints involving a column, created again after it was dropped and added. */
function recreateDrafts(columnName: string, ctx: TableProcessingContext): DraftOperation[] {
  const involves = (columns: readonly string[] | null | undefined) =>
    columns?.includes(columnName) ?? false;
  const note = `dropped with "${columnName}"; created again`;

  // An expression key or a predicate names its columns quoted, as the definition prints them.
  const mentions = (text: string | null | undefined) =>
    text?.includes(quoteIdentifier(columnName)) ?? false;

  const indexes = ctx.local.indexes
    .filter(
      (index) =>
        involves(index.columns.map((c) => c.column)) ||
        index.columns.some((c) => "expression" in c && mentions(c.expression)) ||
        involves(index.include) ||
        mentions(index.where)
    )
    .map((index) => {
      const draft = createIndexDraft(index, ctx.local, true, ctx.options.asyncIndexes);
      return { ...draft, summary: { ...draft.summary, note } };
    });

  const constraints = namedConstraintsOf(ctx.local).flatMap((constraint) => {
    if (constraint.kind === "UNIQUE_CONSTRAINT" && involves(constraint.columns)) {
      return uniquePromotionDrafts(ctx, {
        indexName: uniqueIndexNameForConstraint(constraint.name),
        constraintName: constraint.name,
        columns: constraint.columns,
        include: constraint.include ?? undefined,
        nullsDistinct: constraint.distinctNulls ?? undefined,
        constraintObject: constraint,
      });
    }

    // A CHECK names its columns quoted, as the definition prints them.
    if (
      constraint.kind === "CHECK_CONSTRAINT" &&
      constraint.expression.includes(quoteIdentifier(columnName))
    ) {
      return addCheckDrafts(ctx, constraint);
    }

    return [];
  });

  return [...indexes, ...constraints];
}

function columnDrop(
  columnName: string,
  diff: AnyDiff,
  ctx: TableProcessingContext,
  added: string[]
): ColumnChange {
  if (ctx.remoteKey.includes(columnName)) {
    return refuseColumn(ctx, {
      code: "NO_DROP_PRIMARY_KEY_COLUMN",
      message: `Column "${columnName}" can't be dropped: it's part of the primary key, which DSQL can't change.`,
      column: columnName,
      action: "DROP",
      diffs: [diff],
    });
  }

  const renamed = added.length > 0;
  // Deprecated in an earlier release: the drop was announced, and the client stopped using it.
  const planned = ctx.remoteColumns.get(columnName)?.deprecated === true;

  return {
    drafts: [
      alterTableDraft(ctx, ddl.dropColumn({ columnName, ifExists: ctx.options.ifExists }), {
        subject: tableSubject(ctx.tableName),
        action: "DROP",
        target: { kind: "COLUMN", name: columnName },
        risk: planned ? "lossy" : "destructive",
        note: planned
          ? "deprecated in an earlier release; its data is lost"
          : renamed
            ? `its data is lost — possible rename: ${added.map((name) => `"${name}"`).join(", ")} ` +
              `is added in the same plan; .renamedFrom("${columnName}") would keep the data`
            : "its data is lost",
      }),
    ],
  };
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
      schema: ctx.schema,
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
  // Taken before the loop: a step may claim a leftover before its own diff comes up.
  const leftovers = new Set(ctx.leftoverIndexes.keys());

  for (const [indexName, diffsForIndex] of indexDiffs) {
    const wholeAdd = diffsForIndex.find((d) => d.type === "add" && !d.key);
    const wholeRemove = diffsForIndex.find((d) => d.type === "remove" && !d.key);
    const attrDiffs = diffsForIndex.filter((d) => d.key !== undefined);
    const key = `${ctx.tableName}.${indexName}`;

    if (wholeAdd) {
      // A rebuild that stopped after dropping the old index: build it, then drop the leftover,
      // which enforces any uniqueness until then.
      const create = createIndexOperation(
        wholeAdd.object as IndexSerialized,
        ctx.local,
        options.ifExists,
        options.asyncIndexes
      );
      const leftover = takeLeftover(ctx, rebuildIndexName(indexName));

      operations.push(...(leftover.length > 0 ? change(key, [create, ...leftover]) : [create]));
      continue;
    }

    // A leftover is dropped by the step that builds its name again, or swept after.
    if (wholeRemove && leftovers.has(indexName)) continue;

    if (wholeRemove) {
      operations.push(
        dropIndexOperation(wholeRemove.object as IndexSerialized, ctx.local, options)
      );
      continue;
    }

    if (attrDiffs.length > 0) {
      // An index can't be altered: it is rebuilt — also how an index whose async build failed
      // (`valid: false`) is repaired. The new one is built beside it under another name, and
      // swapped in only once built, so the old one serves reads and enforces uniqueness until
      // then.
      const local = attrDiffs[0].object as IndexSerialized;
      const temporary = rebuildIndexName(indexName);
      const build = createIndexDraft(
        { ...local, name: temporary },
        ctx.local,
        options.ifExists,
        options.asyncIndexes
      );
      const drop = dropIndexDraft(local, ctx.local, options);

      operations.push(
        ...change(key, [
          ...takeLeftover(ctx, temporary),
          {
            ...build,
            summary: {
              ...build.summary,
              changes: attributeChanges(attrDiffs),
              note: `rebuild of ${indexName}: built beside it, which stays in use until the swap`,
            },
          },
          {
            ...drop,
            summary: { ...drop.summary, note: "replaced by the index built in the step before" },
          },
          renameIndexDraft(ctx, temporary, indexName),
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

    const promotion = (unique: AnyUniqueConstraint) => [
      ...takeLeftover(ctx, uniqueIndexNameForConstraint(unique.name)),
      ...uniquePromotionDrafts(ctx, {
        indexName: uniqueIndexNameForConstraint(unique.name),
        constraintName: unique.name,
        columns: unique.columns,
        include: unique.include ?? undefined,
        nullsDistinct: unique.distinctNulls ?? undefined,
        constraintObject: unique,
      }),
    ];

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

    // A changed UNIQUE: its new index is built first, while the old constraint still enforces
    // uniqueness; then the old one is dropped (its index with it) and the new index promoted.
    // Only those two statements run without the constraint.
    if (constraint.kind === "UNIQUE_CONSTRAINT") {
      const drop = dropConstraintDraft(ctx, constraintName);
      const steps = promotion(constraint);
      const promote = steps.pop();

      operations.push(
        ...change(key, [
          ...steps,
          {
            ...drop,
            summary: {
              ...drop.summary,
              note: "replaced by the constraint the next step adds; uniqueness isn't enforced in between",
            },
          },
          ...(promote ? [promote] : []),
        ])
      );
    }
  }

  return { operations, errors };
}

type AnyUniqueConstraint = Extract<ConstraintSerialized, { kind: "UNIQUE_CONSTRAINT" }>;

/** The steps an identity difference takes: one `ALTER COLUMN` action each. */
function identityDrafts(
  columnName: string,
  diff: AnyDiff,
  remote: ColumnSerialized,
  ctx: TableProcessingContext
): ColumnChange {
  const value = diff.value as ColumnSerialized["identity"] | undefined;
  const prev = diff.prevValue as ColumnSerialized["identity"] | undefined;
  const target = { kind: "IDENTITY", name: columnName } as const;

  if (diff.type === "add" && value) {
    // PostgreSQL makes an identity of a NOT NULL column only, and only a NOT NULL from
    // `CREATE TABLE` counts: DSQL can't add one later, and a CHECK doesn't do.
    if (!remote.notNull || ctx.remoteNotNull.has(columnName)) {
      return refuseColumn(ctx, {
        code: "NO_ADD_IDENTITY",
        message:
          `Column "${columnName}" can't become an identity: an identity column must be NOT NULL ` +
          `first, and DSQL can't make an existing column NOT NULL. Use a sequence default ` +
          `(\`nextval\`) instead.`,
        column: columnName,
        action: "ADD",
        diffs: [diff],
      });
    }

    return {
      drafts: [
        alterColumnDraft(
          ctx,
          columnName,
          ddl.addIdentity({
            mode: value.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT",
            options: identitySequenceOptions(value),
          }),
          {
            action: "ADD",
            target,
            changes: [{ attribute: "identity", from: null, to: value.type }],
            risk: "safe",
          }
        ),
      ],
    };
  }

  if (diff.type === "remove") {
    return {
      drafts: [
        alterColumnDraft(ctx, columnName, ddl.dropIdentity({ ifExists: true }), {
          action: "DROP",
          target,
          changes: [{ attribute: "identity", from: prev?.type ?? null, to: null }],
          risk: "lossy",
        }),
      ],
    };
  }

  if (diff.type !== "modify" || !value || !prev) {
    return { drafts: [] };
  }

  const drafts: DraftOperation[] = [];

  if (value.type !== prev.type) {
    drafts.push(
      alterColumnDraft(
        ctx,
        columnName,
        ddl.setGenerated({ mode: value.type === "ALWAYS" ? "ALWAYS" : "BY_DEFAULT" }),
        {
          action: "ALTER",
          target,
          changes: [{ attribute: "identity", from: prev.type, to: value.type }],
          risk: "safe",
        }
      )
    );
  }

  // `dataType` is bigint on both sides on DSQL; any other option is set in place. `startValue`
  // is set with `SET START WITH`, which affects only a later `RESTART`: no value handed out is
  // reused.
  const changed = changedSequenceOptions(value.options, prev.options).filter(
    (key) => key !== "dataType"
  );

  if (changed.length > 0) {
    const next = effectiveSequenceOptions(value.options);
    const before = effectiveSequenceOptions(prev.options);
    const pick = <K extends (typeof changed)[number]>(key: K) =>
      changed.includes(key) ? next[key] : undefined;

    drafts.push(
      alterColumnDraft(
        ctx,
        columnName,
        ddl.setSequenceOptions({
          incrementBy: pick("increment"),
          minValue: pick("minValue"),
          maxValue: pick("maxValue"),
          startValue: pick("startValue"),
          cache: pick("cache"),
          cycle: pick("cycle"),
        }),
        {
          action: "ALTER",
          target,
          changes: changed.map((key) => ({ attribute: key, from: before[key], to: next[key] })),
          // Narrower bounds can make the next value fail.
          risk:
            next.maxValue < before.maxValue || next.minValue > before.minValue ? "lossy" : "safe",
        }
      )
    );
  }

  return { drafts };
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

/** `ALTER INDEX … RENAME`: the last step of a rebuild, swapping the new index in. */
function renameIndexDraft(ctx: TableProcessingContext, from: string, to: string): DraftOperation {
  return {
    type: "ALTER",
    object: ctx.local,
    statement: ddl.alterIndex({
      name: from,
      schema: ctx.schema,
      action: ddl.rename({ newName: to }),
    }),
    references: dedupe(ctx.tableNamespaceRef),
    summary: {
      subject: tableSubject(ctx.tableName),
      action: "RENAME",
      target: { kind: "INDEX", name: to },
      changes: [{ attribute: "name", from, to }],
      risk: "safe",
    },
  };
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
      tableName: ctx.local.name,
      tableSchema: ctx.schema,
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
      name: ctx.local.name,
      schema: ctx.schema,
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
