/** Port of scripts/validate_sources.py -- the three-tier audit.
 *
 *  Findings are plain strings, built to match the Python word for word, because
 *  scripts/check-parity.mjs compares the two sets directly. Where this file deliberately
 *  differs from the Python, the comment says so and docs/parity-notes.md records it.
 */

import {
  CHECKED_VALUES,
  DEFAULT_CHECKED,
  DEFAULT_IMPORTANCE,
  FIELD_ORDER,
  FIELD_SPEC,
  FILE_SIZE_WARN_BYTES,
  MAX_LIST_ITEM,
  REQUIRED_FIELDS,
} from "../schema/schema.generated";
import { looksLikeUrl, normalizeUrl } from "./id";
import { pyLen, pyRepr, typeName } from "./python";
import { folderName } from "./paths";
import type { Findings, SourceDoc, SourceEntry } from "./types";
import { emptyFindings } from "./types";

/** Resolves the `files` field against the repo tree. In the browser this is backed by the
 *  Git Trees API listing rather than os.stat. Implementations normalise with pathKey, so a
 *  backslash-separated path still resolves. */
export interface FileResolver {
  exists(fileField: string): boolean;
  sizeOf(fileField: string): number | null;
}

/** A resolver that finds nothing -- for validating an entry before the tree is loaded. */
export const noFiles: FileResolver = {
  exists: () => false,
  sizeOf: () => null,
};

/** Port of common/lib.py:254 as_list -- iterate a list field defensively, so a mistyped
 *  `urls = "http://a"` is not walked character by character by every consumer. */
export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Port of common/lib.py:263 entry_label.
 *
 *  DIVERGENCE: Python calls .strip() on the raw title, so `title = 5` raises AttributeError
 *  and takes down the whole audit before a single finding prints. Here a non-string title
 *  falls through to "<untitled entry>" and field_validate reports the type as a structural
 *  finding, which is what the Python was trying to do anyway. See docs/parity-notes.md.
 */
export function entryLabel(entry: SourceEntry): string {
  const title = entry.title;
  const text = typeof title === "string" ? title.trim() : "";
  return text || "<untitled entry>";
}

/** Port of common/lib.py:268 has_location -- a source needs at least one url or one file. */
export function hasLocation(entry: SourceEntry): boolean {
  return truthy(entry.urls) || truthy(entry.files);
}

/** Python truthiness for the values a TOML field can hold. */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Port of validate_sources.py:63 canonical -- case-insensitive lookup that returns the
 *  vocabulary's own spelling. Both fixed vocabularies are mixed-case ("No" among lowercase
 *  checked values, "LLM" among lowercase tags), so casing is corrected towards the
 *  vocabulary rather than lowercased; a blind toLowerCase would break exactly those. */
export function canonical(value: string, vocabulary: readonly string[]): string | null {
  const target = value.trim().toLowerCase();
  for (const allowed of vocabulary) {
    if (allowed.toLowerCase() === target) return allowed;
  }
  return null;
}

/** Port of common/lib.py:273 file_missing_problem. */
export function fileMissingProblem(fileField: unknown, files: FileResolver): string | null {
  const field = typeof fileField === "string" ? fileField.trim() : "";
  if (!field) return null;
  if (!files.exists(field)) return `file does not exist on disk: ${pyRepr(field)}`;
  return null;
}

/** Port of common/lib.py:283 file_size_problem. */
export function fileSizeProblem(fileField: unknown, files: FileResolver): string | null {
  const field = typeof fileField === "string" ? fileField.trim() : "";
  if (!field) return null;
  const size = files.sizeOf(field);
  if (size === null) return null;
  if (size <= FILE_SIZE_WARN_BYTES) return null;

  const mb = Math.floor(FILE_SIZE_WARN_BYTES / (1024 * 1024));
  const actual = (size / (1024 * 1024)).toFixed(1);
  return `file is ${actual}MB, over the ${mb}MB convention guideline: ${pyRepr(field)}`;
}

/** Port of validate_sources.py:79 field_validate -- type, length and fixed vocabularies.
 *  Returns a problem string, or null when the field is fine. Never throws. */
export function fieldValidate(
  field: string,
  value: unknown,
  allowedTags: readonly string[],
): string | null {
  const rule = FIELD_SPEC[field];
  if (!rule) return null;

  if (!matchesType(value, rule.type)) {
    return `${field} should be ${pyTypeName(rule.type)}, got ${typeName(value)}: ${pyRepr(value)}`;
  }

  if (rule.type === "array") {
    const items = value as unknown[];

    const nonStrings = items.filter((item) => typeof item !== "string");
    if (nonStrings.length > 0) {
      return `${field} should hold only strings, got ${pyRepr(nonStrings)}`;
    }

    const tooLong = (items as string[]).filter((item) => pyLen(item) > MAX_LIST_ITEM);
    if (tooLong.length > 0) {
      return `${field} has entries over ${MAX_LIST_ITEM} chars: ${pyRepr(tooLong)}`;
    }
  }

  if (rule.maxLength !== null && typeof value === "string" && pyLen(value) > rule.maxLength) {
    return `${field} is ${pyLen(value)} chars, over the ${rule.maxLength} limit`;
  }

  if (field === "checked" && (value as string).trim() && canonical(value as string, CHECKED_VALUES) === null) {
    return `checked=${pyRepr(value)} is not one of ${pyRepr([...CHECKED_VALUES])}`;
  }

  if (field === "tags") {
    const unknown = (value as string[]).filter((tag) => canonical(tag, allowedTags) === null);
    if (unknown.length > 0) {
      return (
        `tags not in allowed_tags.toml: ${pyRepr(unknown)} ` +
        "(fix the tag, or add it to scripts/common/allowed_tags.toml)"
      );
    }
  }

  return null;
}

function pyTypeName(type: string): string {
  return type === "string" ? "str" : type === "integer" ? "int" : "list";
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "array") return Array.isArray(value);
  // Python's isinstance(True, int) is True, so a boolean passes an int field. Faithful.
  if (typeof value === "boolean") return true;
  return typeof value === "number" && Number.isInteger(value);
}

export type Correction = [value: unknown, message: string];

/** Port of validate_sources.py:125 field_normalize -- the minor, mechanically safe fixes.
 *  Returns [newValue, whatChanged] or null. Deliberately does not guess at typos: an
 *  unrecognised tag is reported by fieldValidate and left exactly as written. */
export function fieldNormalize(
  field: string,
  value: unknown,
  allowedTags: readonly string[],
): Correction | null {
  const rule = FIELD_SPEC[field];
  if (!rule) return null;

  if (field === "importance" && (value === "" || value === null || value === undefined)) {
    return [DEFAULT_IMPORTANCE, `importance was blank, defaulted to ${DEFAULT_IMPORTANCE}`];
  }

  // Nothing below is safe on a value of the wrong type (.strip() on an int, say), and
  // fieldValidate already reports the type. One check here covers every field.
  if (!matchesType(value, rule.type)) return null;

  if (field === "checked") {
    const text = value as string;
    if (!text.trim()) {
      return [DEFAULT_CHECKED, `checked was blank, defaulted to ${pyRepr(DEFAULT_CHECKED)}`];
    }
    const fixed = canonical(text, CHECKED_VALUES);
    if (fixed !== null && fixed !== text) {
      return [fixed, `checked ${pyRepr(text)} recased to ${pyRepr(fixed)}`];
    }
    return null;
  }

  if (field === "tags") {
    // Order is meaningful and stays exactly as typed -- tags[0] is the primary tag that
    // makeId builds the entry's id fragment from, so these are never sorted.
    const items = value as unknown[];
    const cleaned: string[] = [];
    for (const raw of items) {
      // DIVERGENCE: Python calls .strip() unguarded here and raises on a non-string tag.
      // Skipping is the reportable equivalent -- fieldValidate already names the type.
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const tag = canonical(trimmed, allowedTags) ?? trimmed;
      if (!cleaned.includes(tag)) cleaned.push(tag);
    }
    if (!sameStringList(cleaned, items)) return [cleaned, "tags stripped, recased and deduped"];
    return null;
  }

  if (typeof value === "string") {
    const stripped = value.trim();
    if (stripped !== value) return [stripped, `${field} had surrounding whitespace`];
    return null;
  }

  if (Array.isArray(value)) {
    const cleaned = value
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .map((item) => item.trim());
    if (!sameStringList(cleaned, value)) return [cleaned, `${field} had blank or padded entries`];
  }

  return null;
}

function sameStringList(cleaned: string[], original: unknown[]): boolean {
  if (cleaned.length !== original.length) return false;
  return cleaned.every((item, index) => item === original[index]);
}

// --- duplicate index ---------------------------------------------------------------------

type Stamp = { folder: string; label: string; key: number };
export type DuplicateIndex = Record<"id" | "title" | "url" | "file", Map<string, Stamp[]>>;

/** An entry paired with the folder it was indexed under and its identity key. */
export interface IndexableEntry {
  entry: SourceEntry;
  /** The SHORT folder name -- `path.parent.name`, as validate_sources.py uses. */
  folder: string;
  key: number;
}

/** Port of validate_sources.py:320 build_index -- map id / title / url / file to every
 *  entry using it, in file order.
 *
 *  The `file` key is the raw trimmed string, NOT a path-normalised one. That is faithful:
 *  duplicate detection in Python compares `file_field.strip()` literally, so
 *  `Attachments\x.pdf` and `Attachments/x.pdf` do not collide here. Only
 *  update_files.py's listed_files goes through pathKey.
 */
export function buildIndex(entries: IndexableEntry[]): DuplicateIndex {
  const index: DuplicateIndex = {
    id: new Map(),
    title: new Map(),
    url: new Map(),
    file: new Map(),
  };

  const push = (kind: keyof DuplicateIndex, key: string, stamp: Stamp) => {
    const bucket = index[kind].get(key);
    if (bucket) bucket.push(stamp);
    else index[kind].set(key, [stamp]);
  };

  for (const { entry, folder, key } of entries) {
    const label = entryLabel(entry);
    const stamp: Stamp = { folder, label, key };

    const entryId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (entryId) push("id", entryId, stamp);

    push("title", label.toLowerCase(), stamp);

    for (const url of asList(entry.urls)) {
      if (typeof url !== "string") continue;
      push("url", normalizeUrl(url), stamp);
    }
    for (const file of asList(entry.files)) {
      if (typeof file !== "string") continue;
      push("file", file.trim(), stamp);
    }
  }

  return index;
}

/** Port of validate_sources.py:182 entry_similar -- this entry's collisions with earlier
 *  entries. Only the later entry of a colliding pair reports, so each pair is named once. */
export function entrySimilar(
  entry: SourceEntry,
  folder: string,
  key: number,
  index: DuplicateIndex,
): string[] {
  const findings: string[] = [];
  const label = entryLabel(entry);

  const entryId = typeof entry.id === "string" ? entry.id.trim() : "";
  const groups: Array<[keyof DuplicateIndex, string[]]> = [
    ["id", [entryId]],
    ["title", [label.toLowerCase()]],
    [
      "url",
      asList(entry.urls)
        .filter((url): url is string => typeof url === "string")
        .map(normalizeUrl),
    ],
    [
      "file",
      asList(entry.files)
        .filter((file): file is string => typeof file === "string")
        .map((file) => file.trim()),
    ],
  ];

  for (const [kind, keys] of groups) {
    for (const value of keys) {
      if (!value) continue;
      const occurrences = index[kind].get(value);
      if (!occurrences || occurrences.length === 0) continue;

      const first = occurrences[0];
      if (first.key === key) continue; // this entry is the original, not the repeat

      findings.push(
        `[${folder}] '${label}': duplicate ${kind} (${value}) -- ` +
          `already used by ${first.folder}:'${first.label}'`,
      );
    }
  }

  return findings;
}

/** Port of validate_sources.py:212 validate -- one entry, findings sorted into three tiers. */
export function validateEntry(
  entry: SourceEntry,
  folder: string,
  key: number,
  index: DuplicateIndex,
  allowedTags: readonly string[],
  files: FileResolver,
): Findings {
  const out = emptyFindings();
  const label = entryLabel(entry);
  const where = `[${folder}] '${label}'`;

  for (const field of REQUIRED_FIELDS) {
    const value = entry[field];
    if (truthy(value)) continue;
    // A blank field a normalizer can fill is a convention fix, not a structural hole.
    if (field in entry && fieldNormalize(field, value, allowedTags) !== null) {
      out.convention.push(`${where}: ${field} is blank (fixable)`);
    } else {
      out.structural.push(`${where}: missing required field ${pyRepr(field)}`);
    }
  }

  // importance is optional, but an entry without one is unranked -- default rather than nag.
  if (!("importance" in entry)) {
    out.convention.push(`${where}: no importance set, defaults to ${DEFAULT_IMPORTANCE} (fixable)`);
  }

  for (const [field, value] of Object.entries(entry)) {
    if (!FIELD_SPEC[field]) {
      out.structural.push(`${where}: unknown field ${pyRepr(field)} (not in FIELD_ORDER)`);
      continue;
    }

    const problem = fieldValidate(field, value, allowedTags);
    if (problem) out.structural.push(`${where}: ${problem}`);

    const correction = fieldNormalize(field, value, allowedTags);
    if (correction !== null && truthy(value)) {
      out.convention.push(`${where}: ${correction[1]} (fixable)`);
    }
  }

  for (const url of asList(entry.urls)) {
    if (typeof url !== "string") continue;
    if (url && !looksLikeUrl(url)) {
      out.structural.push(`${where}: url does not look like an http(s) link: ${pyRepr(url)}`);
    }
  }

  for (const file of asList(entry.files)) {
    const missing = fileMissingProblem(file, files);
    if (missing) out.structural.push(`${where}: ${missing}`);
    const oversized = fileSizeProblem(file, files);
    if (oversized) out.convention.push(`${where}: ${oversized}`);
  }

  if (!hasLocation(entry)) {
    out.structural.push(`${where}: has neither a url nor a file -- no way to locate this source`);
  }

  out.consistency.push(...entrySimilar(entry, folder, key, index));

  return out;
}

/** Port of validate_sources.py:267 order_fields -- FIELD_ORDER first, unknowns kept at the
 *  end rather than dropped. */
export function orderFields(fields: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const field of FIELD_ORDER) {
    if (field in fields) ordered[field] = fields[field];
  }
  for (const [field, value] of Object.entries(fields)) {
    if (!(field in ordered)) ordered[field] = value;
  }
  return ordered;
}

export interface RepoAudit extends Findings {
  fileCount: number;
  fixableCount: number;
}

/** Port of validate_sources.py:349 validate_repo, minus the printing and the y/N gate. */
export function validateRepo(
  docs: SourceDoc[],
  allowedTags: readonly string[],
  files: FileResolver,
): RepoAudit {
  const indexable: IndexableEntry[] = [];
  for (const doc of docs) {
    // The SHORT folder name, matching validate_sources.py's `path.parent.name`.
    const short = folderName(doc.folder);
    for (const parsed of doc.entries) {
      indexable.push({ entry: parsed.entry, folder: short, key: parsed.key });
    }
  }

  const index = buildIndex(indexable);
  const out = emptyFindings();

  for (const { entry, folder, key } of indexable) {
    const found = validateEntry(entry, folder, key, index, allowedTags, files);
    out.structural.push(...found.structural);
    out.consistency.push(...found.consistency);
    out.convention.push(...found.convention);
  }

  return {
    ...out,
    fileCount: docs.length,
    fixableCount: out.convention.filter((finding) => finding.includes("(fixable)")).length,
  };
}
