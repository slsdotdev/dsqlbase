import { SchemaObjectType, SerializedObject, SerializedSchema } from "../base.js";
import { DDLOperationOptions, DEFAULT_DDL_OPERATION_OPTIONS } from "./operations/base.js";
import {
  DDLOperation,
  DDLOperationError,
  diffObjectOperations,
  dropObjectOperations,
  IndexedDDLOperation,
  qualifiedName,
} from "./operations/index.js";
import { planOperations } from "./planner.js";
import { renameTable } from "./operations/rename.js";
import { AnyTableDefinition } from "@dsqlbase/core/definition";

export class SchemaReconciler {
  private readonly _localSchema: Map<string, SerializedObject<SchemaObjectType>>;
  private readonly _remoteSchema: Map<string, SerializedObject<SchemaObjectType>>;

  private _operationIdCounter = 0;
  private readonly _operations: IndexedDDLOperation[] = [];
  private readonly _errors: DDLOperationError[] = [];
  private readonly _options: DDLOperationOptions;

  constructor(
    localSchema: SerializedSchema,
    remoteSchema: SerializedSchema,
    options: Partial<DDLOperationOptions> = {}
  ) {
    this._localSchema = new Map(localSchema.map((obj) => [qualifiedName(obj), obj]));
    this._remoteSchema = new Map(remoteSchema.map((obj) => [qualifiedName(obj), obj]));
    this._options = { ...DEFAULT_DDL_OPERATION_OPTIONS, ...options };
  }

  private _pushOperation(operation: DDLOperation) {
    const id = this._operationIdCounter++;
    this._operations.push({ id, ...operation });
    return id;
  }

  /**
   * Tables renamed with `renamedFrom`: the rename runs first, and the table is then diffed as it
   * will be — under its new name.
   */
  private _renameTables() {
    for (const [name, local] of this._localSchema.entries()) {
      if (local.kind !== "TABLE" || !local.renamedFrom) {
        continue;
      }

      const previous = qualifiedName({ ...local, name: local.renamedFrom });
      const remote = this._remoteSchema.get(previous);
      const result = renameTable(
        local,
        remote?.kind === "TABLE" ? remote : undefined,
        this._remoteSchema.get(name) as SerializedObject<AnyTableDefinition> | undefined
      );

      if (!result) continue;

      if ("error" in result) {
        this._errors.push(result.error);
        continue;
      }

      result.operations.forEach((operation) => this._pushOperation(operation));
      this._remoteSchema.delete(previous);
      this._remoteSchema.set(name, result.remote);
    }
  }

  public run() {
    this._renameTables();

    for (const [name, local] of this._localSchema.entries()) {
      const remote = this._remoteSchema.get(name);
      const { operations, errors } = diffObjectOperations(local, remote, this._options);

      for (const operation of operations) {
        this._pushOperation(operation);
      }

      for (const error of errors) {
        this._errors.push(error);
      }

      this._remoteSchema.delete(name);
    }

    for (const remote of this._remoteSchema.values()) {
      const operation = dropObjectOperations(remote, this._options);
      this._pushOperation(operation);
    }

    return {
      operations: planOperations(this._operations),
      errors: this._errors,
    };
  }
}

export function reconcileSchemas(
  local: SerializedSchema,
  remote: SerializedSchema,
  options: Partial<DDLOperationOptions> = {}
) {
  return new SchemaReconciler(local, remote, options).run();
}
