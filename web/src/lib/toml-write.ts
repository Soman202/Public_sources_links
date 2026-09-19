/** Write `[[source]]` tables into a sources.toml by splicing text, never reserializing.
 *
 *  The Python round-trips through tomlkit, which preserves comments, key order and the
 *  hand-edited spacing in these files (`importance=6` with no spaces survives a rewrite).
 *  There is no tomlkit here, so fidelity comes from a stricter rule: only the bytes of the
 *  entry being changed are ever touched. Add appends, edit replaces one table's range,
 *  delete cuts one out. Everything else in the file is returned verbatim.
 *
 *  LINE ENDINGS. This repo is committed with core.autocrlf=true, so git stores LF and the
 *  Windows working tree is CRLF. The GitHub API serves and accepts the blob, so the web app
 *  works in LF throughout and the desktop still checks out CRLF. The helpers below detect
 *  and reuse whatever the file already uses, so neither assumption can leak into a commit
 *  that rewrites every line.
 */

import { FIELD_ORDER } from "../schema/schema.generated";
import { orderFields } from "./validate";

/** The newline a file already uses. Defaults to LF, which is what git stores here. */
export function detectNewline(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

const CONTROL_ESCAPES: Record<string, string> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
  '"': '\\"',
  "\\": "\\\\",
};

/** A TOML basic string, escaped the way tomlkit writes one. */
export function tomlString(value: string): string {
  let out = "";
  for (const char of value) {
    const escape = CONTROL_ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
    } else if (char < " " || char === "\x7f") {
      out += "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase();
    } else {
      out += char;
    }
  }
  return `"${out}"`;
}

/** A TOML value literal. Arrays render inline, as the toolkit's entries do. */
export function tomlValue(value: unknown): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[" + value.map(tomlValue).join(", ") + "]";
  }
  if (value === null || value === undefined) return '""';
  return tomlString(String(value));
}

/** Render one `[[source]]` table. No trailing newline -- the caller joins.
 *  Fields come out in FIELD_ORDER, with anything unrecognised kept at the end. */
export function renderSourceBlock(fields: Record<string, unknown>, newline = "\n"): string {
  const ordered = orderFields(fields);
  const lines = ["[[source]]"];
  for (const [key, value] of Object.entries(ordered)) {
    lines.push(`${key} = ${tomlValue(value)}`);
  }
  return lines.join(newline);
}

/** Append one entry to a sources.toml, leaving one blank line before it.
 *
 *  That blank line is the same one common/lib.py:63 re-inserts by hand after every dump,
 *  because these files are hand-edited and entries need to stay visually separated.
 */
export function appendEntry(text: string, fields: Record<string, unknown>): string {
  const newline = detectNewline(text);
  const block = renderSourceBlock(fields, newline);

  if (text.trim() === "") return block + newline;

  // Whatever the file ends with is put back verbatim. Tools/sources.toml ends on a blank
  // line and the rest end on a single newline; normalising that would show up as a diff on
  // a line the edit never touched.
  const trailing = text.match(/(\r?\n)+$/)?.[0] ?? newline;
  const body = text.slice(0, text.length - (text.match(/(\r?\n)+$/)?.[0].length ?? 0));

  return body + newline + newline + block + trailing;
}

/** Replace the table at `range` with a freshly rendered one. Bytes outside the range are
 *  untouched, which is what keeps surrounding comments and formatting byte-identical. */
export function replaceEntry(
  text: string,
  range: [number, number],
  fields: Record<string, unknown>,
): string {
  const newline = detectNewline(text);
  const block = renderSourceBlock(fields, newline);
  return text.slice(0, range[0]) + block + text.slice(range[1]);
}

/** Remove the table at `range`, along with the blank line that separated it.
 *
 *  Deleting the range alone would leave the surrounding newlines behind and collapse two
 *  entries onto adjacent lines, so the separator ahead of the block goes with it. Deleting
 *  the first entry instead consumes the separator that follows, so the file does not start
 *  with a blank line.
 */
export function deleteEntry(text: string, range: [number, number]): string {
  const [start, end] = range;
  const newline = detectNewline(text);

  const remainder = text.slice(end);
  const before = text.slice(0, start).replace(/(\r?\n)+$/, "");

  // This was the last entry: whatever newlines ended the file stay as they were, so
  // appending an entry and deleting it again is exactly reversible.
  if (remainder.trim() === "") {
    return before.trim() === "" ? stripLeadingNewlines(remainder) : before + remainder;
  }

  const after = stripLeadingNewlines(remainder);

  // Nothing above this block: the file must not start with a blank line.
  if (before.trim() === "") return after;

  // Otherwise keep one newline closing the previous entry, and one blank line before
  // whatever comes next -- the same separation appendEntry writes.
  return before + newline + newline + after;
}

function stripLeadingNewlines(text: string): string {
  return text.replace(/^(\r?\n)+/, "");
}

/** Build the field dict for a new entry, in FIELD_ORDER, with the toolkit's own defaults
 *  for anything the form does not own. Mirrors add_source.py:56 fill_defaults plus
 *  build_table's ordering, without the interactive parts. */
export function buildFields(entry: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of FIELD_ORDER) {
    if (field in entry) fields[field] = entry[field];
  }
  for (const [field, value] of Object.entries(entry)) {
    if (!(field in fields)) fields[field] = value;
  }
  return fields;
}
