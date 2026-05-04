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

export type ValueType<T extends TypedObject, TValue> = T & {
  __type: { valueType: TValue };
};

export type Generated<T extends TypedObject, TGeneration> = T & {
  __type: { generated: TGeneration };
};

export type Identity<T extends TypedObject, TOptions> = T & {
  __type: {
    notNull: true;
    hasDefault: true;
    identity: TOptions;
  };
};

export type WithNamespace<T extends TypedObject, TSchema extends TypedObject> = T & {
  __type: { namespace: TSchema };
};

export type WithDomain<T extends TypedObject, TDomain extends TypedObject> = T & {
  __type: { domain: TDomain };
};
