/** Parse sources.toml and allowed_tags.toml, keeping the source ranges edits need.
 *
 *  Python round-trips through tomlkit, which preserves comments and formatting. There is no
 *  tomlkit here, so fidelity comes from never rewriting a whole file: this module records
 *  where each `[[source]]` table sits in the text, and toml-write.ts splices within those
 *  ranges. Bytes outside an edited entry are never touched.
 */

import { parseTOML, getStaticTOMLValue } from "toml-eslint-parser";
import type { ParsedEntry, SourceDoc, SourceEntry, UnreadableFile } from "./types";
import { folderOf, normalizeRepoPath } from "./paths";

let nextEntryKey = 1;

/** A raw file as fetched from GitHub, before parsing. */
export interface RawFile {
  /** Repo-relative POSIX path. */
  path: string;
  text: string;
}

export interface LoadResult {
  docs: SourceDoc[];
  unreadable: UnreadableFile[];
}

/** Port of common/lib.py:74 load_all_docs -- parse everything, never throw. A file that
 *  will not parse is a finding for the caller to report, not the end of the run. */
export function loadAllDocs(files: RawFile[]): LoadResult {
  const docs: SourceDoc[] = [];
  const unreadable: UnreadableFile[] = [];

  for (const file of files) {
    try {
      docs.push(parseSourceDoc(file.path, file.text));
    } catch (error) {
      unreadable.push({
        path: normalizeRepoPath(file.path),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { docs, unreadable };
}

/** Parse one sources.toml into entries plus their byte ranges. Throws if the TOML is
 *  malformed -- loadAllDocs is what turns that into a reportable finding. */
export function parseSourceDoc(path: string, text: string): SourceDoc {
  const ast = parseTOML(text);
  const value = getStaticTOMLValue(ast) as Record<string, unknown>;

  const rawSources = Array.isArray(value.source) ? (value.source as SourceEntry[]) : [];
  const ranges = sourceTableRanges(ast);

  const entries: ParsedEntry[] = rawSources.map((entry, index) => ({
    entry,
    // A `[[source]]` with no ranges recorded would mean the AST and the static value
    // disagree, which cannot happen for a document that parsed -- but fall back to a
    // zero-width range at EOF rather than produce an entry that cannot be located.
    range: ranges[index] ?? [text.length, text.length],
    key: nextEntryKey++,
  }));

  // Kept unfiltered: render_md.py interpolates each note into an f-string whatever its
  // type, so dropping non-strings here would lose a line the Python would have written.
  const generalNotes = Array.isArray(value.general_notes) ? (value.general_notes as unknown[]) : [];

  const normalized = normalizeRepoPath(path);
  return {
    path: normalized,
    folder: folderOf(normalized),
    text,
    generalNotes,
    entries,
  };
}

/** [start, end) of every `[[source]]` table, in document order. */
function sourceTableRanges(ast: ReturnType<typeof parseTOML>): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (const node of ast.body[0].body) {
    if (node.type !== "TOMLTable") continue;
    if (node.kind !== "array") continue;
    const key = node.resolvedKey;
    if (key.length !== 2 || key[0] !== "source") continue;
    ranges.push([node.range[0], node.range[1]]);
  }

  return ranges;
}

/** Port of common/lib.py:133 read_tags -- the flat vocabulary from `[[tags]]`. */
export function readTags(allowedTagsToml: string): string[] {
  const value = getStaticTOMLValue(parseTOML(allowedTagsToml)) as Record<string, unknown>;
  const tables = value.tags;
  if (!Array.isArray(tables) || tables.length === 0) return [];

  const first = tables[0] as Record<string, unknown>;
  const tags = first?.tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

/** Port of common/lib.py:139 read_tag_types -- the `[tags_type]` browsing groups.
 *
 *  These overlap on purpose ("LLM" is both a CS tag and a tool tag) and are a browsing aid
 *  only. readTags stays the one vocabulary the validator checks against.
 */
export function readTagTypes(allowedTagsToml: string): Record<string, string[]> {
  const value = getStaticTOMLValue(parseTOML(allowedTagsToml)) as Record<string, unknown>;
  const groups = value.tags_type;
  if (!groups || typeof groups !== "object") return {};

  const out: Record<string, string[]> = {};
  for (const [field, members] of Object.entries(groups as Record<string, unknown>)) {
    out[field] = Array.isArray(members)
      ? members.filter((tag): tag is string => typeof tag === "string")
      : [];
  }
  return out;
}

/** Port of update_files.py:65 read_folder_tags, minus the disk access.
 *
 *  Returns (tags, problem, warning). A problem means the tags cannot be trusted, so every
 *  file below that folder is skipped. A warning means the file is there but adds nothing.
 *  No tags.toml at all is neither -- pass `undefined` for text in that case.
 */
export function readFolderTags(
  where: string,
  text: string | undefined,
  canonicalTag: (tag: string) => string | null,
): { tags: string[]; problem: string | null; warning: string | null } {
  if (text === undefined) return { tags: [], problem: null, warning: null };

  let value: Record<string, unknown>;
  try {
    value = getStaticTOMLValue(parseTOML(text)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { tags: [], problem: `${where}: ${message}`, warning: null };
  }

  const raw = value.tags;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
    return { tags: [], problem: null, warning: `${where}: empty or no 'tags' key -- adds no tags` };
  }

  if (!Array.isArray(raw) || !raw.every((tag) => typeof tag === "string")) {
    return {
      tags: [],
      problem: `${where}: tags should be a list of strings, got ${JSON.stringify(raw)}`,
      warning: null,
    };
  }

  const unknown = (raw as string[]).filter((tag) => canonicalTag(tag) === null);
  if (unknown.length > 0) {
    return {
      tags: [],
      problem: `${where}: tags not in allowed_tags.toml: ${JSON.stringify(unknown)}`,
      warning: null,
    };
  }

  return {
    tags: (raw as string[]).map((tag) => canonicalTag(tag) as string),
    problem: null,
    warning: null,
  };
}
