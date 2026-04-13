export interface TypedObject<T = unknown> {
  /** @internal */
  readonly __type: T;
}

export type NotNull<T extends TypedObject> = T & { __type: { notNull: true } };

export type PrimaryKey<T extends TypedObject> = T & {
  __type: { primaryKey: true; notNull: true };
};

export type Unique<T extends TypedObject> = T & {
  __type: { unique: true };
};

export type HasDefault<T extends TypedObject> = T & {
  __type: { hasDefault: true };
};

export type WithSchema<T extends TypedObject, TSchema extends TypedObject> = T & {
  __type: { schema: TSchema };
};
