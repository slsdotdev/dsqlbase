import { Session } from "@dsqlbase/core";
import { SerializedSchema } from "./base.js";
import { validateDefinition } from "./validation/validate.js";

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

  public async run(definition: SerializedSchema) {
    const validationResult = this.validate(definition);

    if (!validationResult.isValid) {
      throw new Error(
        `Schema definition is invalid. Errors:\n${validationResult.errors
          .map((error) => error.message)
          .join("\n")}`
      );
    }
    // TBD: Implement the logic to run the migration based on the provided serialized schema definition.
    // 1. Validate the definition using the validation module.
    // 2. Inspect remote schema using the introspection module.
    // 3. Normalize remote shape and data types.
    // 4. Reconcile local and remote schemas to identify differences.
    // 5. Determine if operations can be performed
    // 6. Plan, sort, print, execution order of DDL statements.
    // 7. Execute DDL statements against the database.
    // 8. Wait for async operations to complete and verify the final state of the database schema.
  }
}

export function createMigrationRunner(session: Session): MigrationRunner {
  return new MigrationRunner(session);
}
