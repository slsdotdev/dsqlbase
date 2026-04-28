import {
  AnyNamespaceDefinition,
  ColumnConfig,
  ColumnDefinition,
  DomainDefinition,
} from "@dsqlbase/core";
import { WithDomain } from "@dsqlbase/core/utils";

export function domain<TName extends string>(name: TName) {
  const definition = new DomainDefinition<TName, string, string, AnyNamespaceDefinition>(name, {
    notNull: false,
    dataType: "text",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });

  function factory<TColumnName extends string>(
    name: TColumnName
  ): WithDomain<
    ColumnDefinition<TColumnName, ColumnConfig<string, string>>,
    DomainDefinition<TName, string, string, AnyNamespaceDefinition>
  > {
    return new ColumnDefinition<TColumnName, ColumnConfig<string, string>>(name, {
      domain: definition,
      dataType: definition.name,
      codec: {
        encode: (value) => value,
        decode: (value) => value,
      },
    }) as WithDomain<
      ColumnDefinition<TColumnName, ColumnConfig<string, string>>,
      DomainDefinition<TName, string, string, AnyNamespaceDefinition>
    >;
  }

  return Object.assign(factory, {
    check: definition.check.bind(definition),
    notNull: definition.notNull.bind(definition),
    default: definition.default.bind(definition),
    toJSON: definition.toJSON.bind(definition),
    $type: definition.$type.bind(definition),
  });
}
