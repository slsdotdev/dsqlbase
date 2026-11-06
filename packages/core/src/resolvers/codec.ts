/**
 * Converts a column's values to and from what the driver sends and returns. A codec translates
 * and nothing else: every value bound for the column passes through `encode` — writes, filters,
 * `Column.param`, a definition's `.default()` — so a codec that refused values would refuse
 * filters too. Checking a value is `ColumnValidator`'s job.
 *
 * A codec is pure: it sees one value and nothing else, which is why a definition can run it
 * for a DDL default. A transform that needs the column or the row it was read from is a
 * {@link ColumnHooks} instead.
 */
export type ColumnCodec<TRaw, TValue> = {
  encode(value: TValue): TRaw;
  decode(raw: TRaw): TValue;
};

export const defaultCodec: ColumnCodec<unknown, unknown> = {
  encode(value) {
    return value;
  },
  decode(raw) {
    return raw;
  },
};
