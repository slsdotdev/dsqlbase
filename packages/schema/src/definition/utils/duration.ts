export interface Duration {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export const ISO_DURATION_REGEX =
  /^P(([0-9]+Y)?([0-9]+M)?([0-9]+W)?([0-9]+D)?(T([0-9]+H)?([0-9]+M)?([0-9]+(\.?[0-9]+)?S)?)?)?$/;

export const STRING_DURATION_REGEX =
  /(?:(\d+)\s*year[s]?)?\s*(?:(\d+)\s*month[s]?)?\s*(?:(\d+)\s*day[s]?)?\s*(?:(\d+)\s*hour[s]?)?\s*(?:(\d+)\s*minute[s]?)?\s*(?:(\d+(?:\.\d+)?)\s*second[s]?)?/i;

/**
 * Formats a Duration object into an ISO 8601 duration string.
 *
 * @param duration Duration object
 * @returns ISO 8601 duration string like "P3Y6M4DT12H30M5S"
 */

export const formatISODuration = (duration: Partial<Duration>) => {
  let iso = "P";

  if (duration.years) iso += `${duration.years}Y`;
  if (duration.months) iso += `${duration.months}M`;
  if (duration.days) iso += `${duration.days}D`;

  if (duration.hours || duration.minutes || duration.seconds) {
    iso += "T";

    if (duration.hours) iso += `${duration.hours}H`;
    if (duration.minutes) iso += `${duration.minutes}M`;
    if (duration.seconds) {
      const seconds = duration.milliseconds
        ? `${duration.seconds}.${duration.milliseconds}`
        : duration.seconds;

      iso += `${seconds}S`;
    }
  }

  return iso;
};

/**
 * Parses an ISO 8601 duration string into a Duration object. Supported formats include:
 * - "P3Y6M4DT12H30M5S" (3 years, 6 months, 4 days, 12 hours, 30 minutes, and 5 seconds)
 * - "P2Y" (2 years)
 * - "PT15M" (15 minutes)
 * - "P1DT12H" (1 day and 12 hours)
 * - "PT0.5S" (0.5 seconds)
 * @param isoString
 * @returns Duration object
 */

export const parseISODuration = (iso: string): Duration => {
  const match = ISO_DURATION_REGEX.exec(iso);

  if (!match) {
    throw new Error(`Invalid ISO 8601 duration string: ${iso}`);
  }

  const [, years, months, , days, , hours, minutes, seconds] = match;

  return {
    years: parseInt(years) || 0,
    months: parseInt(months) || 0,
    days: parseInt(days) || 0,
    hours: parseInt(hours) || 0,
    minutes: parseInt(minutes) || 0,
    seconds: parseFloat(seconds) || 0,
    milliseconds: seconds.includes(".") ? Math.round((parseFloat(seconds) % 1) * 1000) : 0,
  };
};

/**
 * Formats a Duration object into a human-readable string format.
 *
 * @param duration Duration object
 * @returns String fomrat like "3 years 6 months 4 days 12 hours 30 minutes 5 seconds"
 */

export const formatStringDuration = (duration: Partial<Duration>) => {
  let str = "";

  if (duration.years) str += `${duration.years} year${duration.years > 1 ? "s" : ""} `;
  if (duration.months) str += `${duration.months} month${duration.months > 1 ? "s" : ""} `;
  if (duration.days) str += `${duration.days} day${duration.days > 1 ? "s" : ""} `;
  if (duration.hours) str += `${duration.hours} hour${duration.hours > 1 ? "s" : ""} `;
  if (duration.minutes) str += `${duration.minutes} minute${duration.minutes > 1 ? "s" : ""} `;
  if (duration.seconds) str += `${duration.seconds} second${duration.seconds > 1 ? "s" : ""} `;

  return str.trim();
};

/**
 * Parses a human-readable duration string into a Duration object.
 * Supported formats include:
 * - "3 years 6 months 4 days 12 hours 30 minutes 5 seconds"
 * - "2 hours 15 minutes"
 * - "45 seconds"
 *
 * @param str String formatted duration
 * @returns Duration object
 */

export const parseStringDuration = (str: string): Duration => {
  const match = STRING_DURATION_REGEX.exec(str);

  if (!match) {
    throw new Error(`Invalid duration string: ${str}`);
  }
  const [, years, months, days, hours, minutes, seconds] = match;

  return {
    years: parseInt(years) || 0,
    months: parseInt(months) || 0,
    days: parseInt(days) || 0,
    hours: parseInt(hours) || 0,
    minutes: parseInt(minutes) || 0,
    seconds: parseFloat(seconds) || 0,
    milliseconds: 0,
  };
};

export const safeParseDuration = (value: unknown): Duration => {
  if (typeof value === "string") {
    try {
      return parseISODuration(value);
    } catch {
      return parseStringDuration(value);
    }
  }

  if (typeof value === "object" && value !== null) {
    const { years, months, days, hours, minutes, seconds, milliseconds } =
      value as Partial<Duration>;

    return {
      years: parseInt(String(years)) || 0,
      months: parseInt(String(months)) || 0,
      days: parseInt(String(days)) || 0,
      hours: parseInt(String(hours)) || 0,
      minutes: parseInt(String(minutes)) || 0,
      seconds: parseFloat(String(seconds)) || 0,
      milliseconds: parseInt(String(milliseconds)) || 0,
    };
  }

  throw new Error(`Unsupported duration value: ${value}`);
};
