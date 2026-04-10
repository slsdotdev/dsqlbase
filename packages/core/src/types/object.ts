export interface TypedObject<T = unknown> {
  readonly __type: T;
}

export type NotNull<T extends TypedObject> = T & { __type: { notNull: true } };

export type PrimaryKey<T extends TypedObject> = T & {
  __type: { primaryKey: true; notNull: true };
};

export type Unique<T extends TypedObject> = T & {
  __type: { unique: true };
};

export type WithSchema<T extends TypedObject, TSchema extends TypedObject> = T & {
  __type: { schema: TSchema };
};
