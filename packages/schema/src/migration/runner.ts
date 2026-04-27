import { Session } from "@dsqlbase/core";
import { SerializedSchema } from "./base.js";
import { validateDefinition } from "./validation/validate.js";
import { reconcileSchemas } from "./reconciliation/reconcile.js";

export interface MigrationRunnerOptions {
  /**
   * If true, will simulate the migration process without making any actual changes to the database.
   * Useful for testing and previewing the migration plan before executing it against the database.
   *
   * @default false
   */
  dryRun?: boolean;
  /**
   * If true, will destroy objects that don't match the local definition.
   *
   * **⚠️ Warning:**
   * Use with caution, as this can lead to data loss if not used carefully.
   *
   * @default false
   */
  destructive?: boolean;
}

export class MigrationRunner {
  private readonly _session: Session;

  constructor(session: Session) {
    this._session = session;
  }

  public validate(definition: SerializedSchema) {
    return validateDefinition(definition);
  }

  /**
   * Introspects the remote database schema.
   *
   * This method should be implemented to fetch the current state of the database schema,
   * including tables, columns, data types, constraints, etc.
   *
   * @returns A promise that resolves to the serialized schema of the remote database.
   */

  public async introspect(): Promise<SerializedSchema> {
    throw new Error("introspect method is not implemented yet.");
  }

  public reconcileSchemas(local: SerializedSchema, remote: SerializedSchema) {
    return reconcileSchemas(local, remote);
  }

  /**
   * Runs the migration process based on the provided serialized schema definition.
   *
   * This includes:
   * 1. Validating local definition
   * 2. Introspect remote schema
   * 3. Reconciling local and remote definitions
   * 4. Validating migration plan
   * 5. Execute DDL statements against the database
   * 6. Await async operations and verify final state of the database schema
   *
   * @param definition The serialized schema definition to migrate to.
   * @throws Will throw an error if the schema definition is invalid or if the migration fails.
   */

  public async run(
    definition: SerializedSchema,
    options: MigrationRunnerOptions = {
      dryRun: false,
      destructive: false,
    }
  ) {
    const validationResult = this.validate(definition);

    if (!validationResult.isValid) {
      throw new Error(
        `Schema definition is invalid. Errors:\n${validationResult.errors
          .map((error) => error.message)
          .join("\n")}`
      );
    }

    const remoteSchema = await this.introspect();
    const { errors } = this.reconcileSchemas(definition, remoteSchema);

    if (errors.length > 0) {
      throw new Error(
        `Schema reconciliation failed with errors:\n${errors
          .map((error) => `- ${error.message}`)
          .join("\n")}`
      );
    }

    if (options.dryRun) {
      console.log(
        "Dry run enabled. Migration plan generated successfully, but no changes will be made to the database."
      );
      return;
    }
  }
}

export function createMigrationRunner(session: Session): MigrationRunner {
  return new MigrationRunner(session);
}
