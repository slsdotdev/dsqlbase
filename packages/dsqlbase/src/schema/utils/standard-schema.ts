/**
 * The parts of Standard Schema v1 (https://standardschema.dev) a JSON column uses, copied in as
 * the spec invites, so zod, valibot, arktype and the rest work with no dependency on any of them.
 */
export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
};

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

export type StandardSchemaIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
};

export type InferSchemaInput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["input"];

export type InferSchemaOutput<S extends StandardSchemaV1> = NonNullable<
  S["~standard"]["types"]
>["output"];
