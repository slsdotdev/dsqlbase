export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

export function isEmptyObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function isNullOrFalse(value: unknown): value is null | undefined | false {
  return !isDefined(value) || value === false;
}

export const escapeLike = (value: unknown): string => {
  return String(value).replace(/[\\%_]/g, "\\$&");
};
