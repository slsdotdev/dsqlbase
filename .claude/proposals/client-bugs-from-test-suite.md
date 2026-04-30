# Client bugs surfaced by the new operations test suite

The newly-added per-operation specs in `packages/tests/src/specs/{select,insert,update,delete}.spec.ts` exercise the public client (`createClient` → `DSQLClient`) against PGlite. Each failing test points to a real bug in the implementation. This document explains each one so we can fix them.

| # | Failing test | Symptom | Root cause | Status |
|---|---|---|---|---|
| 1 | `select.spec.ts` › filter operators › `` `in` against a domain column `` | `error: syntax error at or near "$1"` | `IN $1` SQL generated for an array param | open |
| 2 | `insert.spec.ts` › column type round-trips › `` `date` and `datetime` round-trip as Date instances `` | `error: time zone "gmt+0200" not recognized` | Default `datetime` encode used `Date.toString()` | **fixed** — codec rewrite via `formatTimestamp` / `formatDate` / `formatTime` in `packages/schema/src/utils/date.ts` (commit-ready). |
| 3 | `insert.spec.ts` › column type round-trips › `` `duration` (interval) round-trips as ISO 8601 in iso mode `` | `error: invalid input syntax for type interval: "P"` | `parseISODuration` regex/destructure mismatch + fall-through to `parseStringDuration` | **fixed** — named-group rewrite of `ISO_DURATION_REGEX` + anchored `STRING_DURATION_REGEX` in `packages/schema/src/definition/utils/duration.ts`; covered by `duration.test.ts`. |
| 4 | `select.spec.ts` › type round-trips › returns `datetime` (timestamptz) columns as `Date` instances | `expected '2026-…Z' to be an instance of Date` | `datetime` decode returns string instead of Date | **not a bug** — the test fixture had `mode: "iso"` configured on `created_at` / `updated_at`. With `mode: "iso"`, returning an ISO string is the contract. Removing the option (now done in `packages/tests/src/db/schema.ts`) makes the test pass. |
| 5 | `insert.spec.ts` › column type round-trips › `` `duration` (interval) round-trips as ISO 8601 in iso mode `` | `Error: Invalid duration string: 40:00:00` | `interval` decode receives Postgres' default `intervalstyle = 'postgres'` text format (`"40:00:00"` / `"3 years 6 mons 4 days 12:30:05"`), which neither `parseISODuration` nor `parseStringDuration` can handle | **fixed** — new `parsePGIntervalDuration` in `packages/schema/src/definition/utils/duration.ts`, wired into `safeParseDuration` between the ISO and wordy branches. Covered by `duration.test.ts`. |

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

## Bug 3 — `parseISODuration` regex destructure is off-by-one and crashes on missing seconds ✅ FIXED

**Originally in:** `packages/schema/src/definition/utils/duration.ts` — `parseISODuration`.

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

**Fix shipped:** `ISO_DURATION_REGEX` rewritten with named groups (`years` / `months` / `weeks` / `days` / `hours` / `minutes` / `seconds` / `fraction`); `parseISODuration` reads `match.groups` instead of positional indices; the `seconds` and fractional parts are split at the regex level so the runtime `.includes(".")` probe is gone. `STRING_DURATION_REGEX` is now anchored with `^…$` so genuine garbage no longer silently parses as all-zeros. New unit tests in `packages/schema/src/definition/utils/duration.test.ts` (15 cases, all passing) lock in the regression and cover edge cases (`PT0.5S`, `PT1.123S`, bare `P`, weeks syntax, garbage input).

---

## Bug 4 — Not a bug ✅

The reported failure was caused by `mode: "iso"` being configured on `created_at` / `updated_at` in `packages/tests/src/db/schema.ts` (likely leftover debugging). With `mode: "iso"`, decode correctly returns `date.toISOString()` (a string) — that is the documented contract. Removing the option resolved the test. The earlier "narrowed search space" entries here were chasing a misdiagnosis.

---

## Bug 5 — `interval` decode does not understand Postgres' default text format ✅ FIXED

**Originally in:** `packages/schema/src/definition/columns/interval.ts:48` — decode fed PG's `intervalstyle = 'postgres'` output (e.g. `"40:00:00"`, `"3 years 6 mons 4 days 12:30:05"`) into `safeParseDuration`, which only knew ISO and wordy formats. Previously masked by the unanchored `STRING_DURATION_REGEX` silently returning all-zeros; surfaced after Bug 3 anchored that regex.

**Fix shipped:** new `parsePGIntervalDuration` in `packages/schema/src/definition/utils/duration.ts` handles:

- `"HH:MM:SS"` / `"HH:MM:SS.fff"` (time-only, with optional fractional seconds)
- `"-HH:MM:SS"` (signed time — sign propagates to all sub-components)
- `"N days HH:MM:SS"`
- `"N years N mon[th]s N days HH:MM:SS"` (`mon` / `mons` / `month` / `months` all accepted)
- Per-component negatives (e.g. `"-3 years -6 mons -4 days -12:30:05"`)

`safeParseDuration` now tries ISO → PG → wordy. Covered by 8 new cases in `duration.test.ts` (25 total in the file).

---

## Suggested fix order

1. **Bug 1 (`in` operator)** — one-line fix using existing `sql.in`. Trivial, removes a hard runtime crash for any consumer using array filters.
2. **Bug 2 (datetime encode)** — ✅ done.
3. **Bug 3 (duration ISO parser)** — ✅ done.
4. **Bug 5 (interval decode for PG format)** — ✅ done.

The full e2e suite is currently 66/66 green. Bug 1 (`in` operator emits `IN $1`) remains an open code smell worth fixing for any future test that filters by an array — see Bug 1 section above.

Once each bug is fixed, the corresponding test in `packages/tests/src/specs/` should pass without modification.
