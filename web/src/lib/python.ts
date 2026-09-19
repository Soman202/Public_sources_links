/** Python-compatible formatting helpers.
 *
 *  The validator's findings are plain strings built with f-strings and `!r`. The parity test
 *  compares those strings against the Python validator's output character for character, so
 *  `repr` and `type(x).__name__` have to be reproduced rather than approximated.
 */

/** Python's `type(value).__name__` for the values a TOML document can hold. */
export function typeName(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (typeof value === "string") return "str";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (Array.isArray(value)) return "list";
  if (value instanceof Date) return "datetime";
  if (typeof value === "object") return "dict";
  return typeof value;
}

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/** Python's repr() for strings, lists, dicts and scalars.
 *
 *  Strings use single quotes unless the value contains a single quote and no double quote,
 *  which is exactly CPython's rule. Control characters are escaped the same way; printable
 *  non-ASCII is left alone, as it is in Python 3.
 */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);

  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let out = "";
    for (const char of value) {
      if (char === quote) {
        out += "\\" + char;
      } else if (ESCAPES[char] !== undefined) {
        out += ESCAPES[char];
      } else if (char < " " || char === "\x7f") {
        out += "\\x" + char.charCodeAt(0).toString(16).padStart(2, "0");
      } else {
        out += char;
      }
    }
    return quote + out + quote;
  }

  if (Array.isArray(value)) {
    return "[" + value.map(pyRepr).join(", ") + "]";
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${pyRepr(key)}: ${pyRepr(item)}`,
    );
    return "{" + parts.join(", ") + "}";
  }

  return String(value);
}

/** Python's `len()` for a string: code points, not UTF-16 code units.
 *  The difference shows up on any astral character (emoji, rarer CJK), which would
 *  otherwise make every "N chars, over the limit" message disagree with the Python. */
export function pyLen(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** Python's `str.strip()` with no argument: strips whitespace, which for str includes
 *  Unicode whitespace. JS `String.prototype.trim()` matches closely enough that the
 *  difference has never mattered here, so this is just a named alias for intent. */
export function pyStrip(value: string): string {
  return value.trim();
}

/** Whether a character is a Python `\w` word character (Unicode-aware, plus underscore).
 *  Used to reproduce `\b` exactly in countWord. */
function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return /[\p{L}\p{N}_]/u.test(char);
}

/** Port of search.py:70 count_word -- whole-word, case-insensitive occurrences.
 *
 *  Python uses `re.findall(rf"\b{re.escape(term)}\b", text, re.IGNORECASE)`. Rather than
 *  reach for a JS regex (whose `\b` is ASCII-only without the `u` flag, and whose semantics
 *  differ for terms that start or end with a non-word character), this finds every
 *  occurrence and applies Python's own boundary rule: a boundary exists where the
 *  word-ness of the two adjacent characters differs, with out-of-range counting as
 *  non-word. That is exact for any term, including punctuation and non-ASCII.
 */
export function countWord(term: string, text: string): number {
  if (!term) return 0;

  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  let count = 0;
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;

    const before = at > 0 ? text[at - 1] : undefined;
    const first = text[at];
    const last = text[at + needle.length - 1];
    const after = text[at + needle.length];

    const startIsBoundary = isWordChar(before) !== isWordChar(first);
    const endIsBoundary = isWordChar(last) !== isWordChar(after);

    if (startIsBoundary && endIsBoundary) {
      count += 1;
      // findall consumes a successful match, so the next scan starts past it.
      from = at + needle.length;
    } else {
      // A failed match only advances the scan head by one, as the regex engine does.
      from = at + 1;
    }
  }

  return count;
}
