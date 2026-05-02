import { DefinitionNode } from "@dsqlbase/core/definition";
import { isDefinitionObject, SerializedObject } from "../../base.js";

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

export function isDefined<T>(value: T | undefined | null): value is Exclude<T, undefined | null> {
  return value !== undefined && value !== null;
}

export function sortedArray<T>(array: T[]): T[] {
  return array.sort((a, b) => {
    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b);
    }

    if (isDefinitionObject(a) && isDefinitionObject(b)) {
      return a.name.localeCompare(b.name);
    }

    return 0;
  });
}

export function hasDiff<T extends object>(
  local: T | null | undefined,
  remote: T | null | undefined,
  key: keyof T
): boolean {
  if (!isDefined(local)) {
    return isDefined(remote);
  }

  if (!isDefined(remote)) {
    return true;
  }

  const localValue = local[key];
  const remoteValue = remote[key];

  if (typeof localValue !== typeof remoteValue) {
    return true;
  }

  if (typeof localValue === "object" && localValue !== null) {
    if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
      if (localValue.length !== remoteValue.length) {
        return true;
      }

      for (let i = 0; i < localValue.length; i++) {
        if (hasDiff(sortedArray(localValue), sortedArray(remoteValue), i)) {
          return true;
        }
      }

      return false;
    }

    for (const subKey of Object.keys(localValue) as (keyof typeof localValue)[]) {
      if (hasDiff(localValue, remoteValue as typeof localValue, subKey)) {
        return true;
      }
    }

    return false;
  }

  return localValue !== remoteValue;
}

export function diffType<T extends object>(local: T, remote: T, key: keyof T): DiffType {
  if (isDefined(local[key]) && !isDefined(remote[key])) {
    return "add";
  }

  if (!isDefined(local[key]) && isDefined(remote[key])) {
    return "remove";
  }

  return "modify";
}
