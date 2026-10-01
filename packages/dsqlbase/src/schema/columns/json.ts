import {
  ColumnCodec,
  ColumnConfig,
  ColumnDefinition,
  ColumnValidator,
  SQLParam,
} from "@dsqlbase/core";
import { HasDefault, TypedObject } from "@dsqlbase/core/utils";
import { ColumnValidationError } from "../utils/column-validation.js";
import type {
  InferSchemaInput,
  InferSchemaOutput,
  StandardSchemaResult,
  StandardSchemaV1,
} from "../utils/standard-schema.js";

/** A JSON column's types once `.schema()` sets them: writes take its input, reads its output. */
export type WithSchema<T extends TypedObject, S extends StandardSchemaV1> = T & {
  __type: { valueType: InferSchemaOutput<S>; inputType: InferSchemaInput<S> };
};

type JsonColumnConfig = ColumnConfig<unknown, unknown, "json">;

/**
 * A `json` or `jsonb` column. A value may be any JSON value — object, array, string, number or
 * boolean — and `null` is SQL `NULL`, never a JSON `null`.
 *
 * The driver returns these columns parsed, so a read is the value as stored. With `.schema()`,
 * every write and every read is validated.
 */
export class JsonColumnDefinition<
  TName extends string,
  TConfig extends JsonColumnConfig,
> extends ColumnDefinition<TName, TConfig> {
  /** The value `.default()` was given, kept so a later `.schema()` can validate it. */
  protected _defaultInput?: { value: unknown };

  constructor(name: TName, config: Partial<TConfig> = {}) {
    super(name, { ...config, runtimeType: "json", codec: plainJsonCodec } as Partial<TConfig>);
  }

  /**
   * Validates the column with a Standard Schema (zod, valibot, arktype, …), which also types
   * it: a write takes the schema's input, a read returns its output.
   *
   * - **A write** validates the value and stores the schema's **output** — defaults filled,
   *   coercions applied — in its JSON form. It then checks that output validates back to
   *   itself, so a read returns exactly what was stored. A schema that transforms values fails
   *   that check, on the first write that reaches the transform.
   * - **A read** validates the stored value and returns the schema's output, so the read type
   *   holds for every row. A row that fails — written by raw SQL, or under an older schema —
   *   fails the whole read.
   *
   * Failures throw {@link ColumnValidationError}. The schema must validate synchronously.
   *
   * Filters are not validated: a filter value is compared with stored values, and may be only a
   * fragment of one.
   *
   * @example
   * ```ts
   * const Settings = z.object({ theme: z.enum(["light", "dark"]).default("light") });
   *
   * settings: jsonb("settings").schema(Settings)
   * // create({ data: { settings: {} } }) stores {"theme":"light"}
   * ```
   */
  public schema<S extends StandardSchemaV1>(schema: S): WithSchema<this, S> {
    this._validator = schemaValidator(this.name, schema) as typeof this._validator;

    if (this._defaultInput) {
      this.default(this._defaultInput.value);
    }

    return this as WithSchema<this, S>;
  }

  /** Encoded now, so a default the column's schema refuses fails where it is declared. */
  public override default(value: this["__type"]["inputType"]): HasDefault<this> {
    this._defaultInput = { value };
    this._defaultValue = new SQLParam(this._codec.encode(this._toValue(value)));

    return this as HasDefault<this>;
  }
}

const plainJsonCodec: ColumnCodec<unknown, unknown> = {
  encode: (value) => JSON.stringify(value),
  decode: (value) => value,
};

/**
 * Validates writes and reads against `schema`. A write returns the schema's output once it is
 * known to read back as itself: serialized, validated again and serialized to the same text.
 */
function schemaValidator(
  column: string,
  schema: StandardSchemaV1
): ColumnValidator<unknown, unknown> {
  const validate = (value: unknown, phase: "write" | "read") => {
    const result = schema["~standard"].validate(value);

    if (result instanceof Promise) {
      // The pending validation is abandoned; keep its eventual rejection from going unhandled.
      result.catch(() => undefined);
      throw new ColumnValidationError("async", column, phase);
    }

    const settled = result as StandardSchemaResult<unknown>;

    if (settled.issues) {
      throw new ColumnValidationError("invalid", column, phase, settled.issues);
    }

    return settled.value;
  };

  return {
    write(input) {
      const output = validate(input, "write");
      const text = toJson(output, column);
      const again = toJson(validate(JSON.parse(text), "write"), column);

      if (again !== text) {
        throw new ColumnValidationError("unstable", column, "write");
      }

      return output;
    },
    read(stored) {
      return validate(stored, "read");
    },
  };
}

function toJson(value: unknown, column: string): string {
  let text: string | undefined;

  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }

  if (text === undefined) {
    throw new ColumnValidationError("not_json", column, "write");
  }

  return text;
}

/**
 * Defines a `json` column. Prefer {@link jsonb}: `json` stores the text as given and has no
 * equality operator, so it can be neither compared nor used with `distinct`.
 *
 * @param name Column name in database
 * @returns Serializable column definition for a JSON column.
 */
export function json<const TName extends string>(name: TName) {
  return new JsonColumnDefinition<TName, JsonColumnConfig>(name, { dataType: "json" });
}

/**
 * Defines a `jsonb` column: a JSON value stored parsed, which Postgres can compare.
 *
 * In Aurora DSQL a `jsonb` value is limited to 1 MiB compressed, and a `jsonb` column cannot be
 * indexed.
 *
 * @param name Column name in database
 * @returns Serializable column definition for a JSONB column.
 */
export function jsonb<const TName extends string>(name: TName) {
  return new JsonColumnDefinition<TName, JsonColumnConfig>(name, { dataType: "jsonb" });
}
