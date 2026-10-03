import { isDeepStrictEqual } from "node:util";

/**
 * A default expression reduced to what it means, as far as can be told from its text alone.
 *
 * PostgreSQL stores a default parsed and prints it back deparsed, so the definition's
 * `current_timestamp` reads back as `CURRENT_TIMESTAMP` and `'EUR'` as `'EUR'::text`. These
 * rules cover the spellings that differ consistently: keyword case, a literal's cast, quoting of
 * a number, and the formatting of a JSON literal. Anything else compares as text — a default
 * whose spelling the rules do not cover re-plans as changed rather than going unnoticed.
 *
 * Interim: a snapshot of the last applied definition is planned, which avoids round-tripping
 * expressions through the catalog at all.
 */
type CanonicalDefault =
  | { kind: "number"; value: string }
  | { kind: "string"; value: string; cast?: string }
  | { kind: "expression"; value: string };

/** `'…'` followed by a cast: `'EUR'::text`, `'2.5'::double precision`, `'v'::character varying(10)`. */
const CAST_LITERAL =
  /^('(?:[^']|'')*')::([a-z][a-z0-9_ ]*(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?)$/i;
const QUOTED = /^'(?:[^']|'')*'$/;
const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const JSON_CASTS = new Set(["json", "jsonb"]);

function canonical(expression: string): CanonicalDefault {
  const text = expression.trim();
  const cast = CAST_LITERAL.exec(text);
  const literal = cast?.[1] ?? (QUOTED.test(text) ? text : undefined);

  if (literal !== undefined) {
    const value = literal.slice(1, -1).replace(/''/g, "'");

    return NUMBER.test(value)
      ? { kind: "number", value: Number(value).toString() }
      : { kind: "string", value, cast: cast?.[2]?.toLowerCase() };
  }

  if (NUMBER.test(text)) {
    return { kind: "number", value: Number(text).toString() };
  }

  return { kind: "expression", value: upperOutsideQuotes(text) };
}

/** Upper-cases everything outside `'…'` and `"…"`: keywords and unquoted names fold, text does not. */
function upperOutsideQuotes(text: string): string {
  return text.replace(
    /('(?:[^']|'')*'|"(?:[^"]|"")*")|[^'"]+/g,
    (part, quoted?: string) => quoted ?? part.toUpperCase()
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Whether two default expressions — the definition's and the database's — set the same
 * default. A JSON literal compares by value only when a side casts it to `json` / `jsonb`; on a
 * text column `'{"a":1}'` and `'{"a": 1}'` are different strings.
 */
export function sameDefault(
  local: string | null | undefined,
  remote: string | null | undefined
): boolean {
  if (local == null || remote == null) {
    return local == null && remote == null;
  }

  const a = canonical(local);
  const b = canonical(remote);

  if (a.kind === "string" && b.kind === "string") {
    const json = JSON_CASTS.has(a.cast ?? "") || JSON_CASTS.has(b.cast ?? "");

    if (json && /^[[{]/.test(a.value) && /^[[{]/.test(b.value)) {
      const parsed = parseJson(a.value);
      return parsed !== undefined && isDeepStrictEqual(parsed, parseJson(b.value));
    }
  }

  return a.kind === b.kind && a.value === b.value;
}
