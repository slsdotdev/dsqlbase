import {
  AnyNamespaceDefinition,
  ColumnConfig,
  ColumnDefinition,
  DomainDefinition,
} from "@dsqlbase/core";

export function domain<TName extends string>(name: TName) {
  const definition = new DomainDefinition<TName, string, string, AnyNamespaceDefinition>(name, {
    notNull: false,
    dataType: "text",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });

  function factory<TColumnName extends string>(name: TColumnName) {
    return new ColumnDefinition<
      TColumnName,
      ColumnConfig<
        (typeof definition)["__type"]["valueType"],
        (typeof definition)["__type"]["rawType"]
      >
    >(name, {
      domain: definition,
      dataType: definition.name,
      codec: {
        encode: (value) => value,
        decode: (value) => value,
      },
    });
  }

  Object.assign((name: string) => factory(name), definition);

  return factory;
}
