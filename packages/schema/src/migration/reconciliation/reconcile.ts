import { DefinitionNode } from "@dsqlbase/core";
import { SchemaObjectType, SerializedObject, SerializedSchema } from "../base.js";
import {
  createDomainStatement,
  createIndexStatement,
  createSchemaStatement,
  createSequenceStatement,
  createTableStatement,
} from "./statements.js";
import { ddl } from "../ddl/index.js";
import { diffTable } from "./diffs.js";
import {
  DDLOperation,
  DDLOperationError,
  IndexedDDLOperation,
  qualifiedName,
  resolveTableDiff,
} from "./resolvers.js";

export class SchemaReconciler {
  private readonly _localSchema: Map<string, SerializedObject<SchemaObjectType>>;
  private readonly _remoteSchema: Map<string, SerializedObject<SchemaObjectType>>;

  private _operationIdCounter = 0;
  private readonly _operations: IndexedDDLOperation[] = [];
  private readonly _operationRegistry = new Map<string, number[]>();
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

  private _pushCreateOperations(obj: SerializedObject<SchemaObjectType>) {
    if (obj.kind === "SCHEMA") {
      this._pushOperation({
        type: "CREATE",
        object: obj,
        statement: createSchemaStatement(obj),
      });
    }

    if (obj.kind === "TABLE") {
      const tableName = qualifiedName(obj);
      const { statement, references } = createTableStatement(
        obj,
        true,
        obj.namespace && obj.namespace !== "public" ? [obj.namespace] : []
      );

      this._pushOperation({
        type: "CREATE",
        object: obj,
        statement: statement,
        references,
      });

      if (obj.indexes.length) {
        for (const idx of obj.indexes) {
          this._pushOperation({
            type: "CREATE",
            object: idx,
            statement: createIndexStatement(idx, tableName),
            references: [tableName],
          });
        }
      }
    }

    if (obj.kind === "DOMAIN") {
      const statement = createDomainStatement(obj);
      this._pushOperation({
        type: "CREATE",
        object: obj,
        statement: statement,
        references: obj.namespace && obj.namespace !== "public" ? [obj.namespace] : undefined,
      });
    }

    if (obj.kind === "SEQUENCE") {
      const statement = createSequenceStatement(obj);
      this._pushOperation({
        type: "CREATE",
        object: obj,
        statement: statement,
        references: obj.namespace && obj.namespace !== "public" ? [obj.namespace] : undefined,
      });
    }
  }

  private _pushDropOperations(obj: SerializedObject<SchemaObjectType>) {
    if (obj.kind === "SCHEMA") {
      const statement = ddl.dropSchema({
        name: obj.name,
        ifExists: true,
        cascade: "CASCADE",
      });

      this._pushOperation({
        type: "DROP",
        object: obj,
        statement: statement,
      });
    }

    if (obj.kind === "TABLE") {
      const statement = ddl.dropTable({
        name: obj.name,
        schema: obj.namespace,
        ifExists: true,
        cascade: "CASCADE",
      });

      this._pushOperation({
        type: "DROP",
        object: obj,
        statement: statement,
      });
    }

    if (obj.kind === "DOMAIN") {
      const statement = ddl.dropDomain({
        name: obj.name,
        schema: obj.namespace,
        ifExists: true,
        cascade: "CASCADE",
      });

      this._pushOperation({
        type: "DROP",
        object: obj,
        statement: statement,
        references: obj.namespace && obj.namespace !== "public" ? [obj.namespace] : undefined,
      });
    }

    if (obj.kind === "SEQUENCE") {
      const statement = ddl.dropSequence({
        name: obj.name,
        schema: obj.namespace,
        ifExists: true,
        cascade: "CASCADE",
      });

      this._pushOperation({
        type: "DROP",
        object: obj,
        statement: statement,
        references: obj.namespace && obj.namespace !== "public" ? [obj.namespace] : undefined,
      });
    }
  }

  private _pushUpdateOperations<T extends SerializedObject<SchemaObjectType>>(local: T, remote: T) {
    if (local.kind === "TABLE" && remote.kind === "TABLE") {
      const diffs = diffTable(local, remote);

      for (const diff of diffs) {
        const { operations, errors } = resolveTableDiff(local, diff);

        for (const operation of operations) {
          this._pushOperation(operation);
        }

        for (const error of errors) {
          this._errors.push(error);
        }
      }
    }
  }

  public run() {
    for (const [name, local] of this._localSchema.entries()) {
      const remote = this._remoteSchema.get(name);

      if (!remote) {
        this._pushCreateOperations(local);
        continue;
      }

      if (local.kind !== remote.kind) {
        this._errors.push({
          code: "OBJECT_MISMATCH",
          message: `Object kind mismatch for ${name}: local is ${local.kind}, remote is ${remote.kind}`,
          object: local,
        });

        continue;
      }

      this._pushUpdateOperations(local, remote);
      this._remoteSchema.delete(name);
    }

    for (const remote of this._remoteSchema.values()) {
      this._pushDropOperations(remote);
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
