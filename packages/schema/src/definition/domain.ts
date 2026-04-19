import { ColumnConfig, ColumnDefinition, DomainConfig, DomainDefinition } from "@dsqlbase/core";
import { WithDomain } from "@dsqlbase/core/utils";

export function domain<TName extends string>(name: TName) {
  const definition = new DomainDefinition<TName, DomainConfig<string, string>>(name, {
    notNull: false,
    dataType: "text",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });

  const factory = Object.assign(
    <TColumnName extends string>(
      name: TColumnName
    ): WithDomain<
      ColumnDefinition<
        TColumnName,
        ColumnConfig<
          (typeof definition)["__type"]["valueType"],
          (typeof definition)["__type"]["rawType"]
        >
      >,
      typeof definition
    > => {
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
      }) as WithDomain<
        ColumnDefinition<
          TColumnName,
          ColumnConfig<
            (typeof definition)["__type"]["valueType"],
            (typeof definition)["__type"]["rawType"]
          >
        >,
        typeof definition
      >;
    },
    definition
  );

  return factory;
}
