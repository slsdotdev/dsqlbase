import { AnyNamespaceDefinition, SequenceDefinition } from "@dsqlbase/core";

/**
 * Creates a sequence definition.
 * A sequence is a database object that generates a sequence of unique numeric values.
 * @example
 * ```ts
 * const userIdSequence = sequence("user_id_seq");
 * ```
 *
 * @param name The name of the sequence.
 * @returns A new SequenceDefinition instance.
 */

export function sequence<const TName extends string>(name: TName) {
  return new SequenceDefinition<TName, AnyNamespaceDefinition>(name);
}
