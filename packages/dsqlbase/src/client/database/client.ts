import { DefinitionSchema } from "@dsqlbase/core";
import { BaseClient } from "./base.js";

export class DatabaseClient<TDefinition extends DefinitionSchema> extends BaseClient<TDefinition> {}
