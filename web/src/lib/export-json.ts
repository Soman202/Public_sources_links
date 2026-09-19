/** Port of scripts/export_json.py -- the flat sources.json at the repo root.
 *
 *  Output must be byte-identical to the Python's: two-space indent, non-ASCII left
 *  unescaped, one trailing newline.
 */

import { todayIso } from "./id";
import type { SourceDoc, SourceRecord, SourcesJson } from "./types";

/** Port of export_json.py:16 build_json. */
export function buildJson(docs: SourceDoc[], now: Date = new Date()): SourcesJson {
  const sources: SourceRecord[] = [];

  for (const doc of docs) {
    for (const parsed of doc.entries) {
      // `folder` is stamped last, so it reads as provenance after the entry's own fields,
      // and holds the FULL relative path so Tools and Tools/Free tools stay distinguishable.
      sources.push({ ...parsed.entry, folder: doc.folder });
    }
  }

  return {
    generated_at: todayIso(now),
    count: sources.length,
    sources,
  };
}

/** Port of export_json.py:37 main's serialisation.
 *
 *  Python writes `json.dumps(data, indent=2, ensure_ascii=False) + "\n"`. JSON.stringify
 *  with an indent of 2 produces the same layout and also leaves non-ASCII unescaped, so the
 *  only thing to add is the trailing newline.
 */
export function serializeJson(data: SourcesJson): string {
  return JSON.stringify(data, null, 2) + "\n";
}
