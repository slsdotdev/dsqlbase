export type DateTimeMode = "iso" | "string" | "date";

export const safeParseDate = (value: unknown) => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);

    if (isNaN(parsed)) {
      throw new Error(`Invalid date string: ${value}`);
    }

    return new Date(parsed);
  }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new Error(`Invalid Date object: ${value}`);
    }

    return value;
  }

  throw new Error(`Unsupported date value: ${value}`);
};

export const utcDate = (date: Date) => {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
};
