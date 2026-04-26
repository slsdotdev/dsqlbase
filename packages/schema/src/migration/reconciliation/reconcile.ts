import { DefinitionNode } from "@dsqlbase/core";
import { SchemaObjectType, SerializedObject, SerializedSchema } from "../base.js";
import {
  DDLOperation,
  DDLOperationError,
  diffObjectOperations,
  dropObjectOperations,
  IndexedDDLOperation,
  qualifiedName,
} from "./operations/index.js";

export class SchemaReconciler {
  private readonly _localSchema: Map<string, SerializedObject<SchemaObjectType>>;
  private readonly _remoteSchema: Map<string, SerializedObject<SchemaObjectType>>;

  private _operationIdCounter = 0;
  private readonly _operationRegistry = new Map<string, number[]>();
  private readonly _operations: IndexedDDLOperation[] = [];
  private readonly _errors: DDLOperationError[] = [];

  constructor(localSchema: SerializedSchema, remoteSchema: SerializedSchema) {
    this._localSchema = new Map(localSchema.map((obj) => [qualifiedName(obj), obj]));
    this._remoteSchema = new Map(remoteSchema.map((obj) => [qualifiedName(obj), obj]));
  }

  private _registerOperation(object: SerializedObject<DefinitionNode>): number {
    const subject = qualifiedName(object);
    const id = this._operationIdCounter++;

    if (!this._operationRegistry.has(subject)) {
      this._operationRegistry.set(subject, []);
    }

    this._operationRegistry.get(subject)?.push(id);
    return id;
  }

  private _pushOperation(operation: DDLOperation) {
    const id = this._registerOperation(operation.object);
    this._operations.push({ id: id, ...operation });

    return id;
  }

  public run() {
    for (const [name, local] of this._localSchema.entries()) {
      const remote = this._remoteSchema.get(name);
      const { operations, errors } = diffObjectOperations(local, remote);

      for (const operation of operations) {
        this._pushOperation(operation);
      }

      for (const error of errors) {
        this._errors.push(error);
      }

      this._remoteSchema.delete(name);
    }

    for (const remote of this._remoteSchema.values()) {
      const operation = dropObjectOperations(remote);
      this._pushOperation(operation);
    }

    return {
      operations: this._operations,
      errors: this._errors,
    };
  }
}

export function reconcileSchemas(local: SerializedSchema, remote: SerializedSchema) {
  return new SchemaReconciler(local, remote).run();
}
