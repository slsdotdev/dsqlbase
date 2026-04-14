export type Prettify<T extends object> = {
  [K in keyof T]: T[K];
} & {};

export type Optional<T, K extends keyof T> = {
  [P in K]?: T[P];
} & Omit<T, K>;

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

export type HasDefault<T extends TypedObject> = T & {
  __type: { hasDefault: true };
};

export type WithValueType<T extends TypedObject, TValue> = T & {
  __type: { valueType: TValue };
};

export type WithSchema<T extends TypedObject, TSchema extends TypedObject> = T & {
  __type: { schema: TSchema };
};
