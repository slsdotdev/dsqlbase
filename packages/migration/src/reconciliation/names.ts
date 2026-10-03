/**
 * Names the planner derives from others. PostgreSQL limits an identifier to 63 bytes and
 * silently truncates a longer one, after which the next plan would no longer recognise the
 * object it built — so every derived name is kept within the limit here.
 */

/** PostgreSQL's identifier limit, in bytes; a longer name is silently truncated to it. */
const MAX_IDENTIFIER_BYTES = 63;
const utf8 = new TextEncoder();

/** FNV-1a, 32-bit: a stable, dependency-free fingerprint for a name too long to keep whole. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8.encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A name the planner derives from another (`<base>_<suffix>`), kept within 63 bytes. The server
 * would truncate a longer one silently, and the next plan would no longer recognise what it
 * built. Past the limit, `base` is cut on a character boundary and a fingerprint of the full name
 * keeps the result unique: `<base prefix>_<fingerprint>_<suffix>`. The same input always derives
 * the same name, so the planner finds it again.
 */
export function deriveIdentifier(base: string, suffix: string): string {
  const full = `${base}_${suffix}`;
  if (utf8.encode(full).length <= MAX_IDENTIFIER_BYTES) return full;

  const tail = `_${fingerprint(full)}_${suffix}`;
  return clip(base, MAX_IDENTIFIER_BYTES - utf8.encode(tail).length) + tail;
}

/** The longest prefix of `text` within `maxBytes`, cut on a character boundary. */
function clip(text: string, maxBytes: number): string {
  let out = "";

  for (const char of text) {
    if (utf8.encode(out + char).length > maxBytes) break;
    out += char;
  }

  return out;
}

/**
 * `<name1>_<name2>_<label>` within 63 bytes, as PostgreSQL's `makeObjectName` builds it: the
 * longer of the two names loses a byte at a time until the whole fits, then each is cut on a
 * character boundary. It is how PostgreSQL names an inline `UNIQUE` (`<table>_<column>_key`), so
 * a name derived this way matches the one the database chose; the planner's own `_not_null`
 * CHECK uses it too.
 */
export function postgresObjectName(name1: string, name2: string, label: string): string {
  const available = MAX_IDENTIFIER_BYTES - (utf8.encode(label).length + 1) - 1;
  let bytes1 = utf8.encode(name1).length;
  let bytes2 = utf8.encode(name2).length;

  while (bytes1 + bytes2 > available) {
    if (bytes1 > bytes2) bytes1--;
    else bytes2--;
  }

  return `${clip(name1, bytes1)}_${clip(name2, bytes2)}_${label}`;
}
