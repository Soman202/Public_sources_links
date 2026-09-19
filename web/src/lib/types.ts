/** Shared shapes for the ported toolkit. */

/** One [[source]] table, as plain values. Every field is optional because the whole point
 *  of the validator is to report entries that are missing them. */
export interface SourceEntry {
  id?: unknown;
  title?: unknown;
  importance?: unknown;
  description?: unknown;
  urls?: unknown;
  tags?: unknown;
  checked?: unknown;
  files?: unknown;
  platform?: unknown;
  cost?: unknown;
  date_editing?: unknown;
  notes?: unknown;
  [field: string]: unknown;
}

/** A source record as it appears in sources.json: the entry's fields plus its folder. */
export interface SourceRecord extends SourceEntry {
  folder: string;
}

export interface SourcesJson {
  generated_at: string;
  count: number;
  sources: SourceRecord[];
}

/** One parsed sources.toml. `text` is kept verbatim so edits can be spliced into it. */
export interface SourceDoc {
  /** Repo-relative POSIX path, e.g. "Education_materials/TP/sources.toml". */
  path: string;
  /** The folder holding it, full relative path, e.g. "Education_materials/TP". */
  folder: string;
  text: string;
  generalNotes: unknown[];
  entries: ParsedEntry[];
}

/** An entry plus where its table sits in the file, which is what makes splice-editing safe. */
export interface ParsedEntry {
  entry: SourceEntry;
  /** [start, end) offsets of the whole `[[source]]` table within SourceDoc.text. */
  range: [number, number];
  /** Stable identity, standing in for Python's `id(entry)` in duplicate detection. */
  key: number;
}

/** A file that would not parse. Reported, never thrown. */
export interface UnreadableFile {
  path: string;
  message: string;
}

export type Tier = "structural" | "consistency" | "convention";

export interface Findings {
  structural: string[];
  consistency: string[];
  convention: string[];
}

export const emptyFindings = (): Findings => ({
  structural: [],
  consistency: [],
  convention: [],
});

export const mergeFindings = (into: Findings, from: Findings): Findings => {
  into.structural.push(...from.structural);
  into.consistency.push(...from.consistency);
  into.convention.push(...from.convention);
  return into;
};
