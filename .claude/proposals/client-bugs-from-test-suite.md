# Client bugs surfaced by the new operations test suite

The newly-added per-operation specs in `packages/tests/src/specs/{select,insert,update,delete}.spec.ts` exercise the public client (`createClient` → `DSQLClient`) against PGlite. Each failing test points to a real bug in the implementation. This document explains each one so we can fix them.

| # | Failing test | Symptom | Root cause | Status |
|---|---|---|---|---|
| 1 | `select.spec.ts` › filter operators › `` `in` against a domain column `` | `error: syntax error at or near "$1"` | `IN $1` SQL generated for an array param | open |
| 2 | `insert.spec.ts` › column type round-trips › `` `date` and `datetime` round-trip as Date instances `` | `error: time zone "gmt+0200" not recognized` | Default `datetime` encode used `Date.toString()` | **fixed** — codec rewrite via `formatTimestamp` / `formatDate` / `formatTime` in `packages/schema/src/utils/date.ts` (commit-ready). |
| 3 | `insert.spec.ts` › column type round-trips › `` `duration` (interval) round-trips as ISO 8601 in iso mode `` | `error: invalid input syntax for type interval: "P"` | `parseISODuration` regex/destructure mismatch + fall-through to `parseStringDuration` | open |
| 4 | `select.spec.ts` › type round-trips › returns `datetime` (timestamptz) columns as `Date` instances | `expected '2026-…Z' to be an instance of Date` | `datetime` decode returns string instead of Date | **persists after codec rewrite** — root cause is upstream of the codec body (see updated section below). |

---

## Bug 1 — `in` operator emits invalid SQL

**File:** `packages/client/src/model/normalizer.ts:129-132`

```ts
if (isFilterType(condition, "in")) {
  expressions.push(sql`${column} IN ${sql.param(condition.in)}`);
  continue;
}
```

`sql.param(condition.in)` binds the entire array as a single positional parameter, producing SQL like:

```sql
"tasks"."status" IN $1
```

PostgreSQL requires either `IN ($1, $2, …)` (an explicit list) or `= ANY($1)` (with the param being an array). `IN $1` is a hard syntax error.

**Fix options:**

- **Reuse the existing helper** at `packages/core/src/sql/tag.ts:121-124`:
  ```ts
  expressions.push(sql.in(column, condition.in));
  ```
  This expands to `IN (val1, val2, val3, …)`, each value bound as its own param. Same pattern as the rest of `tag.ts`.
- **Or use `= ANY`:**
  ```ts
  expressions.push(sql`${column} = ANY(${sql.param(condition.in)})`);
  ```
  Slightly more efficient with large arrays since the array stays a single param.

The first option is mechanical and matches existing convention.

---

## Bug 2 — `datetime` encode produces a timezone string Postgres rejects ✅ FIXED

**Originally in:** `packages/schema/src/definition/columns/timestamp.ts` — the `timestamp()` factory's `codec.encode` fell back to `Date.toString()`, which produced locale-dependent literals like `"Tue Apr 30 2026 06:49:33 GMT+0200 (CEST)"`. Postgres parsed the `GMT+0200` suffix and rejected it.

**Fix shipped:** the encode/decode logic was centralised in `packages/schema/src/utils/date.ts` and reused by `timestamp.ts`, `date.ts`, and `time.ts`:

- New helpers: `formatTimestamp(date, { tz })`, `formatDate(date)`, `formatTime(date, { tz })`.
- Encode contract: driven by `tz` only (mode never affects the wire format).
  - `tz: true` → `date.toISOString()` (UTC).
  - `tz: false` → space-separated **local wall-clock** components.
  - `date` (no tz concept) → local-component `YYYY-MM-DD`.
  - `time tz: true` → UTC `HH:mm:ss.SSSZ`; `time tz: false` → local `HH:mm:ss.SSS`.
- Decode contract: `mode` continues to control output shape (`"date"` / `"iso"` / `"string"`).
- Companion unit tests in `packages/schema/src/utils/date.test.ts` (18 cases, all passing) lock the formatter behaviour against TZ-runner drift.

**Remaining for the same family of columns:** the `date()` column previously emitted `Date.toDateString()` (`"Wed Apr 30 2026"`) — same shape of bug. It's resolved by the same change.

---

## Bug 3 — `parseISODuration` regex destructure is off-by-one and crashes on missing seconds

**File:** `packages/schema/src/utils/duration.ts:?` (the `parseISODuration` function)

The regex captures 9 groups (outer + Y / M / W / D / T-block + H / M / S / fractional) but the destructure pattern targets the wrong indices:

```ts
const ISO_DURATION_REGEX =
  /^P(([0-9]+Y)?([0-9]+M)?([0-9]+W)?([0-9]+D)?(T([0-9]+H)?([0-9]+M)?([0-9]+(\.?[0-9]+)?S)?)?)?$/;

const [, years, months, , days, , hours, minutes, seconds] = match;
```

For input `"PT40H"`, the match groups are:

| index | regex group | value |
|---|---|---|
| 0 | full match | `"PT40H"` |
| 1 | outer | `"T40H"` |
| 2 | Y | `undefined` |
| 3 | M (months) | `undefined` |
| 4 | W | `undefined` |
| 5 | D | `undefined` |
| 6 | T-block | `"T40H"` |
| 7 | H | `"40H"` |
| 8 | M (minutes) | `undefined` |
| 9 | S | `undefined` |

But the destructure assigns:

| variable | from index | actual value |
|---|---|---|
| `years` | `match[1]` | `"T40H"` |
| `months` | `match[2]` | `undefined` |
| `days` | `match[4]` | `undefined` |
| `hours` | `match[6]` | `"T40H"` |
| `minutes` | `match[7]` | `"40H"` |
| `seconds` | `match[8]` | `undefined` |

So `parseInt(years)` etc. all give `NaN → 0` except `minutes = parseInt("40H") = 40`.

Then it gets worse: the very next line is

```ts
milliseconds: seconds.includes(".") ? … : 0,
```

`seconds` is `undefined`, so `.includes(".")` throws `TypeError`. That throw propagates out of `parseISODuration`, the `try` in `safeParseDuration` swallows it, and execution falls through to `parseStringDuration("PT40H")`.

`parseStringDuration` uses a non-anchored, all-optional regex. `"PT40H"` matches *as the empty alternation*, every group is `undefined`, and the resulting Duration is all zeros. `formatISODuration({all zeros})` returns just `"P"`, which Postgres rejects.

**Fix:** rewrite `parseISODuration` to match groups by name (or fix the destructure indices) and guard the `seconds.includes(".")` branch:

```ts
const [, years, months, , weeks, days, , hours, minutes, seconds] = match; // align with all 9 groups
…
milliseconds:
  seconds && seconds.includes(".")
    ? Math.round((parseFloat(seconds) % 1) * 1000)
    : 0,
```

Or use named groups (`/^P(?<years>[0-9]+Y)?…$/`) which are far less brittle and self-document.

Also worth: anchor `STRING_DURATION_REGEX` (`^…$`) so an empty match doesn't silently succeed when ISO parsing fails for unrelated reasons.

---

## Bug 4 — `datetime` decode returns a string instead of a Date

**Status:** persists after the Bug 2 codec rewrite. Root cause is **upstream of the codec body** — the codec source-as-printed (via `Function.prototype.toString` on the built artifact) returns a `Date`, but the codec actually invoked at runtime returns a `string`. So the `_codec` reference visible from the column at runtime is not the codec the factory just minted.

**Symptom:** `client.teams.findMany({})` → each row's `createdAt` / `updatedAt` is a string (`"2026-04-30T13:38:57.900Z"`), not a `Date`. Asserting `expect(team.createdAt).toBeInstanceOf(Date)` fails.

**Confirmed:**

1. PGlite returns `timestamp with time zone` columns as `Date` objects from `pg.query(text)` and `pg.query(text, params)`. Same SQL run via `client.$execute(...)` returns `Date` for `created_at`.
2. The `datetime("created_at")` column resolves to a `TimestampColumnDefinition`. The built `dist/definition/columns/timestamp.js` decode body is the new `case "iso" | case "string" | default: return date;` chain — verified by reading the file.
3. `safeParseDate(Date)` returns the same `Date`.
4. Calling `column._codec.decode(new Date())` through `schema.teams.columns.createdAt._codec` at runtime returns a `string` (`typeof === "string"`, `constructor.name === "String"`). Re-implementing the same body inline returns a `Date`.

**Narrowed search space (next investigator should start here):**

- **`ColumnDefinition` subclass `_codec` assignment order.** `TimestampColumnDefinition` extends `ColumnDefinition`; the parent constructor sets `this._codec = config.codec ?? defaultCodec` (`packages/core/src/definition/column.ts:59`). Confirm the timestamp factory is actually passing `codec` into `super()` and that nothing later (e.g., a chained method call from the schema) replaces `_codec` with `defaultCodec`.
- **`notNull()` / `defaultNow()` chain.** Both are called on the column in `packages/tests/src/db/schema.ts`. Their bodies (in core's `column.ts` and schema's `timestamp.ts`) only mutate `_notNull` / `_defaultValue`, but worth reading at HEAD to confirm.
- **Module identity.** Vitest + workspace `dist/` resolution sometimes loads two copies of a dep when one path goes through SSR transform and another doesn't. If a different `ColumnDefinition` constructor is running than the one the factory imported from, `super()` could go to a stale class whose constructor uses an old `defaultCodec`. `instanceof TimestampColumnDefinition` is true (probed), so this is unlikely but cheap to rule out.
- **Tooling angle.** Add a single `console.log` at the top of `ColumnDefinition.constructor` printing `config.codec` for the `created_at` column. If the log shows the timestamp codec there but `column._codec.decode` later returns string, the corruption happens **after** the constructor.

**Why the codec rewrite didn't fix it:** the rewrite changed the codec body (which is irrelevant — the decoder we ship is correct). Whatever swaps the live `_codec` reference at runtime is doing so regardless of what we wrote.

**Fix priority:** medium-high. Bug 2 unblocks every Date-in path, so the test suite is mostly green; Bug 4 only blocks consumers who want `instanceof Date` on read. Worth fixing for ergonomics, but no longer urgent.

---

## Suggested fix order

1. **Bug 1 (`in` operator)** — one-line fix using existing `sql.in`. Trivial, removes a hard runtime crash for any consumer using array filters.
2. **Bug 2 (datetime encode)** — ✅ done. Centralised `formatTimestamp` / `formatDate` / `formatTime` + `safeParseDate` in `packages/schema/src/utils/date.ts`, applied to all three column types, covered by `packages/schema/src/utils/date.test.ts`.
3. **Bug 4 (datetime decode)** — see narrowed search space above; not solved by the codec rewrite. Worth a focused session.
4. **Bug 3 (duration parser)** — rewrite `parseISODuration` with named groups in `packages/schema/src/utils/duration.ts` and add a sibling test file covering each ISO component combination.

Once each bug is fixed, the corresponding test in `packages/tests/src/specs/` should pass without modification.
