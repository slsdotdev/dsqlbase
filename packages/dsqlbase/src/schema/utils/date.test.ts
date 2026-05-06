import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatTime,
  formatTimestamp,
  safeParseDate,
  utcDate,
} from "./date.js";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

describe("safeParseDate", () => {
  it("returns the same Date when given a Date instance", () => {
    const d = new Date("2026-04-30T09:00:00.000Z");
    expect(safeParseDate(d)).toBe(d);
  });

  it("parses an ISO 8601 string into a Date with the same instant", () => {
    const iso = "2026-04-30T09:00:00.000Z";
    const parsed = safeParseDate(iso);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getTime()).toBe(Date.parse(iso));
  });

  it("throws on an unparseable string", () => {
    expect(() => safeParseDate("not a date")).toThrow(/Invalid date string/);
  });

  it("throws on an Invalid Date object", () => {
    expect(() => safeParseDate(new Date("nope"))).toThrow(/Invalid Date object/);
  });

  it("throws on unsupported value types", () => {
    expect(() => safeParseDate(123)).toThrow(/Unsupported date value/);
    expect(() => safeParseDate(null)).toThrow(/Unsupported date value/);
    expect(() => safeParseDate(undefined)).toThrow(/Unsupported date value/);
    expect(() => safeParseDate({})).toThrow(/Unsupported date value/);
  });
});

describe("utcDate", () => {
  it("returns a Date at UTC midnight using the input's local Y/M/D", () => {
    const local = new Date(2026, 3, 30, 14, 30, 0); // Apr 30, 14:30 local
    const utc = utcDate(local);

    expect(utc.getUTCFullYear()).toBe(2026);
    expect(utc.getUTCMonth()).toBe(3);
    expect(utc.getUTCDate()).toBe(30);
    expect(utc.getUTCHours()).toBe(0);
    expect(utc.getUTCMinutes()).toBe(0);
    expect(utc.getUTCSeconds()).toBe(0);
  });
});

describe("formatTimestamp", () => {
  it("`tz: true` emits ISO 8601 in UTC with Z suffix", () => {
    const d = new Date("2026-04-30T09:00:00.000Z");
    expect(formatTimestamp(d, { tz: true })).toBe("2026-04-30T09:00:00.000Z");
  });

  it("`tz: true` round-trips through `new Date(...)` to the same instant", () => {
    const d = new Date("2026-04-30T09:15:42.123Z");
    const round = new Date(formatTimestamp(d, { tz: true }));
    expect(round.getTime()).toBe(d.getTime());
  });

  it("`tz: false` emits space-separated local wall-clock components", () => {
    const d = new Date(2026, 3, 30, 12, 5, 7, 8); // Apr 30 12:05:07.008 local
    const expected =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `.${pad(d.getMilliseconds(), 3)}`;

    expect(formatTimestamp(d, { tz: false })).toBe(expected);
  });

  it("`tz: false` zero-pads sub-second component to 3 digits", () => {
    const d = new Date(2026, 0, 1, 0, 0, 0, 5); // .005 ms
    expect(formatTimestamp(d, { tz: false })).toMatch(/\.005$/);
  });

  it("supports pre-epoch dates via ISO mode", () => {
    const d = new Date("1969-07-20T20:17:00.000Z");
    expect(formatTimestamp(d, { tz: true })).toBe("1969-07-20T20:17:00.000Z");
  });
});

describe("formatDate", () => {
  it("formats local Y/M/D as YYYY-MM-DD", () => {
    const d = new Date(2026, 3, 30, 14, 30, 0); // Apr 30 local
    expect(formatDate(d)).toBe("2026-04-30");
  });

  it("uses local components — a date constructed at local 23:30 stays on the same local day", () => {
    // Whatever zone the runner is in, this Date's local day must be Apr 30, 2026.
    const d = new Date(2026, 3, 30, 23, 30, 0);
    expect(formatDate(d)).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    );
    expect(formatDate(d)).toBe("2026-04-30");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5); // Jan 5
    expect(formatDate(d)).toBe("2026-01-05");
  });
});

describe("formatTime", () => {
  it("`tz: true` emits UTC HH:mm:ss.SSS with Z suffix", () => {
    const d = new Date("2026-04-30T09:00:00.000Z");
    expect(formatTime(d, { tz: true })).toBe("09:00:00.000Z");
  });

  it("`tz: false` emits local HH:mm:ss.SSS without offset", () => {
    const d = new Date(2026, 3, 30, 12, 5, 7, 8);
    const expected =
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `.${pad(d.getMilliseconds(), 3)}`;

    expect(formatTime(d, { tz: false })).toBe(expected);
  });

  it("zero-pads sub-second component to 3 digits", () => {
    const d = new Date(2026, 0, 1, 0, 0, 0, 5);
    expect(formatTime(d, { tz: false })).toMatch(/\.005$/);
    expect(formatTime(d, { tz: true })).toMatch(/\.005Z$/);
  });

  it("`new Date(0)` formats as midnight UTC under tz: true", () => {
    expect(formatTime(new Date(0), { tz: true })).toBe("00:00:00.000Z");
  });
});
