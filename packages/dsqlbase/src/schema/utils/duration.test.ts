import { describe, expect, it } from "vitest";
import {
  formatISODuration,
  parseISODuration,
  parsePGIntervalDuration,
  safeParseDuration,
} from "./duration.js";

describe("parseISODuration", () => {
  it("parses `PT40H` (regression for destructure-index bug)", () => {
    expect(parseISODuration("PT40H")).toEqual({
      years: 0,
      months: 0,
      days: 0,
      hours: 40,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
  });

  it("parses a fully populated duration", () => {
    expect(parseISODuration("P3Y6M4DT12H30M5S")).toEqual({
      years: 3,
      months: 6,
      days: 4,
      hours: 12,
      minutes: 30,
      seconds: 5,
      milliseconds: 0,
    });
  });

  it("parses years-only", () => {
    expect(parseISODuration("P2Y")).toMatchObject({ years: 2, months: 0, hours: 0 });
  });

  it("parses minutes-only", () => {
    expect(parseISODuration("PT15M")).toMatchObject({ minutes: 15, hours: 0, seconds: 0 });
  });

  it("parses days+hours", () => {
    expect(parseISODuration("P1DT12H")).toMatchObject({ days: 1, hours: 12 });
  });

  it("parses fractional seconds < 1", () => {
    expect(parseISODuration("PT0.5S")).toMatchObject({ seconds: 0, milliseconds: 500 });
  });

  it("parses fractional seconds with leading integer", () => {
    expect(parseISODuration("PT1.123S")).toMatchObject({ seconds: 1, milliseconds: 123 });
  });

  it("parses bare `P` as all zeros", () => {
    expect(parseISODuration("P")).toEqual({
      years: 0,
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
  });

  it("accepts weeks syntax but does not propagate them", () => {
    // `Duration` has no `weeks` field; `P2W` is valid syntax that produces all zeros.
    expect(parseISODuration("P2W")).toEqual({
      years: 0,
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
  });

  it("throws on garbage input", () => {
    expect(() => parseISODuration("garbage")).toThrow(/Invalid ISO 8601 duration/);
  });
});

describe("parsePGIntervalDuration", () => {
  it("parses time-only `40:00:00`", () => {
    expect(parsePGIntervalDuration("40:00:00")).toMatchObject({
      hours: 40,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
  });

  it("parses fractional seconds", () => {
    expect(parsePGIntervalDuration("12:30:05.5")).toMatchObject({
      hours: 12,
      minutes: 30,
      seconds: 5,
      milliseconds: 500,
    });
  });

  it("parses signed time and propagates the sign to all subcomponents", () => {
    expect(parsePGIntervalDuration("-12:30:05.250")).toMatchObject({
      hours: -12,
      minutes: -30,
      seconds: -5,
      milliseconds: -250,
    });
  });

  it("parses `4 days 12:30:05`", () => {
    expect(parsePGIntervalDuration("4 days 12:30:05")).toMatchObject({
      days: 4,
      hours: 12,
      minutes: 30,
      seconds: 5,
    });
  });

  it("parses the verbose `3 years 6 mons 4 days HH:MM:SS` shape", () => {
    expect(parsePGIntervalDuration("3 years 6 mons 4 days 12:30:05")).toEqual({
      years: 3,
      months: 6,
      days: 4,
      hours: 12,
      minutes: 30,
      seconds: 5,
      milliseconds: 0,
    });
  });

  it("accepts `month`/`months` in addition to `mon`/`mons`", () => {
    expect(parsePGIntervalDuration("6 months")).toMatchObject({ months: 6 });
    expect(parsePGIntervalDuration("1 month")).toMatchObject({ months: 1 });
  });

  it("supports per-component negatives", () => {
    expect(parsePGIntervalDuration("-3 years -6 mons -4 days -12:30:05")).toMatchObject({
      years: -3,
      months: -6,
      days: -4,
      hours: -12,
      minutes: -30,
      seconds: -5,
    });
  });

  it("throws on garbage", () => {
    expect(() => parsePGIntervalDuration("not-an-interval")).toThrow(/Invalid Postgres interval/);
  });
});

describe("safeParseDuration", () => {
  it("round-trips `PT40H` through the ISO branch", () => {
    expect(safeParseDuration("PT40H")).toMatchObject({ hours: 40 });
  });

  it("round-trips `40:00:00` through the PG branch", () => {
    expect(safeParseDuration("40:00:00")).toMatchObject({ hours: 40 });
  });

  it("round-trips `3 years 6 mons 4 days 12:30:05` through the PG branch", () => {
    expect(safeParseDuration("3 years 6 mons 4 days 12:30:05")).toMatchObject({
      years: 3,
      months: 6,
      days: 4,
      hours: 12,
    });
  });

  it("throws when no parser can match", () => {
    expect(() => safeParseDuration("not-a-duration")).toThrow();
  });

  it("accepts a partial Duration object", () => {
    expect(safeParseDuration({ hours: 5, minutes: 30 })).toMatchObject({
      hours: 5,
      minutes: 30,
      years: 0,
    });
  });
});

describe("formatISODuration round-trip", () => {
  it("re-emits `PT40H` from a parsed value", () => {
    expect(formatISODuration(parseISODuration("PT40H"))).toBe("PT40H");
  });

  it("re-emits a fully populated duration", () => {
    expect(formatISODuration(parseISODuration("P3Y6M4DT12H30M5S"))).toBe("P3Y6M4DT12H30M5S");
  });
});
