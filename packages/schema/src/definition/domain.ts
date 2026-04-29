import { AnyNamespaceDefinition, DomainDefinition } from "@dsqlbase/core";

/**
 * Creates a domain definition.
 * A domain is a user-defined data type that can be used to define columns in tables. It allows you to specify constraints and validation rules for the data stored in the column.
 * @example
 * ```ts
 * const emailDomain = domain("email")
 *   .check((value) => sql`${value} LIKE '%@%'`, "email_format_check");
 *
 * const usersTable = table("users", {
 *   email: emailDomain.column("email"),
 * });
 * ```
 * @param name The name of the domain.
 * @returns A new DomainDefinition instance.
 */

export function domain<TName extends string>(name: TName) {
  return new DomainDefinition<TName, string, string, AnyNamespaceDefinition>(name, {
    notNull: false,
    dataType: "text",
    codec: {
      encode: (value) => value,
      decode: (value) => value,
    },
  });
}
