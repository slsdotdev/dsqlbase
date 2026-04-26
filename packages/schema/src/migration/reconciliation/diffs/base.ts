import { DefinitionNode } from "@dsqlbase/core/definition";
import { SerializedObject } from "../../base.js";

export type DiffType = "add" | "remove" | "modify";
export type DiffValue<
  TType extends DiffType,
  TObject extends SerializedObject<DefinitionNode>,
> = TType extends "modify"
  ? TObject[keyof TObject] extends (infer V)[]
    ? V
    : TObject[keyof TObject]
  : TObject;

export interface Diff<TType extends DiffType, TObject extends SerializedObject<DefinitionNode>> {
  type: TType;
  kind: TObject["kind"];
  name: TObject["name"];
  object: TObject;
  key?: keyof TObject;
  value?: DiffValue<TType, TObject>;
  prevValue?: DiffValue<TType, TObject>;
}

export function hasDiff<T extends SerializedObject<DefinitionNode>>(
  local: T | null | undefined,
  remote: T | null | undefined,
  key: keyof T
): boolean {
  return local?.[key] !== remote?.[key];
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function diffType<T extends SerializedObject<DefinitionNode>>(
  local: T,
  remote: T,
  key: keyof T
): DiffType {
  if (isSet(local[key]) && !isSet(remote[key])) {
    return "add";
  }

  if (!isSet(local[key]) && isSet(remote[key])) {
    return "remove";
  }

  return "modify";
}
