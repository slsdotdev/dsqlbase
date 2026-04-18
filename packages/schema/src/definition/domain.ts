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

  function factory<TColumnName extends string, TDomain extends typeof definition>(
    name: TColumnName
  ): WithDomain<
    ColumnDefinition<
      TColumnName,
      ColumnConfig<TDomain["__type"]["valueType"], TDomain["__type"]["rawType"]>
    >,
    TDomain
  > {
    return new ColumnDefinition<TColumnName, ColumnConfig<string, string>>(name, {
      domain: definition,
      dataType: definition.name,
      codec: {
        encode: (value) => value,
        decode: (value) => value,
      },
    }) as WithDomain<ColumnDefinition<TColumnName, ColumnConfig<string, string>>, TDomain>;
  }

  return Object.assign(factory, definition);
}
