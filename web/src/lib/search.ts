/** Port of scripts/search.py -- ranked search and collection statistics.
 *
 *      score = 4 per query term matching one of the entry's tags
 *            + (9 - importance)
 *            + 1 per whole-word occurrence in title, description and notes
 *
 *  The importance bonus only ever breaks ties: an entry needs a real tag or word hit to
 *  appear at all. A term that is both a tag and a word scores for both.
 */

import { CHECKED_VALUES } from "../schema/schema.generated";
import { countWord } from "./python";
import { importanceOf } from "./render-md";
import { asList, entryLabel } from "./validate";
import type { SourceEntry } from "./types";

export const TAG_WEIGHT = 4;
export const IMPORTANCE_BASE = 9;
export const TOP_N = 20;

/** An entry paired with the folder it lives in -- the FULL relative path, so Tools and
 *  Tools/Free tools stay distinguishable once everything is in one list. */
export interface SearchableEntry {
  entry: SourceEntry;
  folder: string;
}

export interface Match {
  score: number;
  entry: SourceEntry;
  folder: string;
  tagHits: string[];
  wordHits: Array<[term: string, count: number]>;
}

/** Port of search.py:62 haystack -- the three prose fields, joined. */
export function haystack(entry: SourceEntry): string {
  return (["title", "description", "notes"] as const)
    .map((field) => entry[field])
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

/** Port of search.py:80 score_entry. The breakdown is returned so a result line can show
 *  where the number came from. */
export function scoreEntry(
  entry: SourceEntry,
  terms: string[],
): { score: number; tagHits: string[]; wordHits: Array<[string, number]> } {
  const tags = new Set(
    asList(entry.tags)
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.toLowerCase()),
  );
  const text = haystack(entry);

  const tagHits = terms.filter((term) => tags.has(term.toLowerCase()));

  const wordHits: Array<[string, number]> = [];
  for (const term of terms) {
    const count = countWord(term, text);
    if (count) wordHits.push([term, count]);
  }

  const score =
    TAG_WEIGHT * tagHits.length +
    (IMPORTANCE_BASE - importanceOf(entry)) +
    wordHits.reduce((total, [, count]) => total + count, 0);

  return { score, tagHits, wordHits };
}

/** Port of search.py:97 search -- every entry with at least one tag or word hit, best first. */
export function search(entries: SearchableEntry[], terms: string[]): Match[] {
  const matches: Match[] = [];

  for (const { entry, folder } of entries) {
    const { score, tagHits, wordHits } = scoreEntry(entry, terms);
    if (tagHits.length > 0 || wordHits.length > 0) {
      matches.push({ score, entry, folder, tagHits, wordHits });
    }
  }

  // Ties break towards the more important entry, then alphabetically, so the order is
  // stable between runs rather than falling back to whatever the glob returned.
  matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const importance = importanceOf(a.entry) - importanceOf(b.entry);
    if (importance !== 0) return importance;
    return compareStrings(entryLabel(a.entry).toLowerCase(), entryLabel(b.entry).toLowerCase());
  });

  return matches;
}

/** Python compares strings by code point. JS `<` compares UTF-16 code units, which differs
 *  above the BMP; comparing by code point keeps the ordering identical. */
function compareStrings(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i += 1) {
    const diff = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/** Python's `str.split()` with no argument: split on runs of whitespace, no empty pieces. */
export function splitTerms(query: string): string[] {
  const trimmed = query.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

// --- statistics ---------------------------------------------------------------------------

export interface Stats {
  total: number;
  byImportance: Array<[importance: number, count: number]>;
  byTag: Array<[tag: string, count: number]>;
  unusedTags: string[];
  unknownTags: string[];
  byTagField: Array<[field: string, count: number]>;
  unfiled: number;
  byChecked: Array<[stage: string, count: number]>;
  offVocabularyChecked: Array<[stage: string, count: number]>;
  cost: { free: number; unspecified: number; other: number };
  otherCosts: string[];
}

function countBy<T>(items: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/** Port of the stats_* functions in search.py:141-195. */
export function collectionStats(
  entries: SearchableEntry[],
  allowedTags: readonly string[],
  tagTypes: Record<string, string[]>,
): Stats {
  const importance = countBy(entries.map(({ entry }) => importanceOf(entry)));

  const tagCounts = new Map<string, number>();
  for (const { entry } of entries) {
    for (const tag of asList(entry.tags)) {
      if (typeof tag !== "string") continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  // An entry counts once in a field if any of its tags belongs there. The fields overlap
  // by design, so this does not sum to the entry count.
  const fieldCounts = new Map<string, number>();
  let unfiled = 0;
  for (const { entry } of entries) {
    const tags = new Set(
      asList(entry.tags).filter((tag): tag is string => typeof tag === "string"),
    );
    const hit = Object.entries(tagTypes)
      .filter(([, members]) => members.some((member) => tags.has(member)))
      .map(([field]) => field);
    for (const field of hit) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    if (hit.length === 0) unfiled += 1;
  }

  const checked = countBy(
    entries.map(({ entry }) => (typeof entry.checked === "string" ? entry.checked.trim() : "")),
  );

  // cost is free text, so anything that isn't blank or the word "free" is left as written
  // rather than guessed at -- "$39 per month (6,00 cloud credits)" is not a number.
  const cost = { free: 0, unspecified: 0, other: 0 };
  const otherCosts: string[] = [];
  for (const { entry } of entries) {
    const raw = typeof entry.cost === "string" ? entry.cost.trim() : "";
    if (!raw) cost.unspecified += 1;
    else if (raw.toLowerCase() === "free") cost.free += 1;
    else {
      cost.other += 1;
      otherCosts.push(raw);
    }
  }

  const byCountThenName = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || compareStrings(a[0].toLowerCase(), b[0].toLowerCase());

  return {
    total: entries.length,
    byImportance: [...importance.entries()].sort((a, b) => a[0] - b[0]),
    byTag: [...tagCounts.entries()].sort(byCountThenName),
    unusedTags: allowedTags.filter((tag) => !tagCounts.has(tag)),
    unknownTags: [...tagCounts.keys()].filter((tag) => !allowedTags.includes(tag)).sort(compareStrings),
    byTagField: [...fieldCounts.entries()].sort(byCountThenName),
    unfiled,
    byChecked: CHECKED_VALUES.map((stage) => [stage, checked.get(stage) ?? 0] as [string, number]),
    offVocabularyChecked: [...checked.entries()]
      .filter(([stage]) => !(CHECKED_VALUES as readonly string[]).includes(stage))
      .sort((a, b) => compareStrings(a[0], b[0])),
    cost,
    otherCosts: [...otherCosts].sort(compareStrings),
  };
}
