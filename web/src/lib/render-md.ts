/** Port of scripts/render_md.py -- the generated browsing view next to every sources.toml.
 *
 *  Output must be byte-identical to the Python's, because the parity test diffs it against
 *  the committed sources.md files.
 */

import { DEFAULT_IMPORTANCE } from "../schema/schema.generated";
import { asList, fileMissingProblem, type FileResolver } from "./validate";
import type { SourceDoc, SourceEntry } from "./types";

export const MD_FILENAME = "sources.md";

/** Port of render_md.py:26 importance_of -- sort key, lower = more important.
 *
 *  A missing or malformed value sorts as DEFAULT_IMPORTANCE, the same slot the validator
 *  would give it once defaulted, so browsing order doesn't jump when that fix is applied.
 *  Booleans are numbers in Python (`isinstance(True, int)`), so they pass through as 1/0.
 */
export function importanceOf(entry: SourceEntry): number {
  const importance = entry.importance;
  if (typeof importance === "boolean") return importance ? 1 : 0;
  if (typeof importance === "number" && Number.isInteger(importance)) return importance;
  return DEFAULT_IMPORTANCE;
}

/** Python f-string interpolation of an arbitrary value. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** A field read as text then stripped -- Python's `(entry.get(f) or "").strip()`. */
function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown): string[] {
  return asList(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Port of render_md.py:37 render_entry. */
export function renderEntry(entry: SourceEntry, files: FileResolver): string[] {
  const title = textField(entry.title) || "(untitled)";
  const urls = cleanList(entry.urls);
  const fileFields = cleanList(entry.files);
  const tags = cleanList(entry.tags);

  const lines: string[] = [`## ${title}`];

  const importance = entry.importance;
  if (typeof importance === "number" && Number.isInteger(importance)) {
    lines.push(`- **Importance:** ${importance}`);
  } else if (typeof importance === "boolean") {
    lines.push(`- **Importance:** ${importance ? "True" : "False"}`);
  }

  if (urls.length > 0) {
    lines.push(`- **URL:** ${urls[0]}`);
    if (urls.length > 1) lines.push(`- **Also:** ${urls.slice(1).join(", ")}`);
  } else if (fileFields.length === 0) {
    lines.push("- **URL:** _(missing)_");
  }

  for (const fileField of fileFields) {
    const marker = fileMissingProblem(fileField, files) ? " _(file not found!)_" : "";
    lines.push(`- **File:** ${fileField}${marker}`);
  }

  for (const [label, field] of [
    ["Platform", "platform"],
    ["Cost", "cost"],
  ] as const) {
    const value = textField(entry[field]);
    if (value) lines.push(`- **${label}:** ${value}`);
  }

  const checked = textField(entry.checked);
  lines.push(`- **Checked:** ${checked ? checked : "_(blank)_"}`);

  if (tags.length > 0) lines.push(`- **Tags:** ${tags.join(", ")}`);

  const dateEditing = textField(entry.date_editing);
  if (dateEditing) lines.push(`- **Updated:** ${dateEditing}`);

  lines.push("");

  const description = textField(entry.description);
  if (description) lines.push(description, "");

  const notes = textField(entry.notes);
  if (notes) lines.push(`_Notes: ${notes}_`, "");

  lines.push("---", "");
  return lines;
}

/** Port of render_md.py:90 render_folder. `folderName` is the FULL relative path, matching
 *  `path.parent.relative_to(repo_root()).as_posix()`. */
export function renderFolder(
  folderPath: string,
  generalNotes: unknown[],
  entries: SourceEntry[],
  files: FileResolver,
): string {
  const lines: string[] = [
    `# ${folderPath}`,
    "",
    "_Generated from `sources.toml` -- edit that file, not this one._",
    "",
  ];

  if (generalNotes.length > 0) {
    lines.push("## Notes");
    for (const note of generalNotes) lines.push(`- ${asText(note)}`);
    lines.push("");
  }

  if (entries.length === 0) {
    lines.push("_No sources yet._");
    return lines.join("\n") + "\n";
  }

  // Python's sorted() is stable, so ties keep TOML order.
  const sorted = entries
    .map((entry, position) => ({ entry, position }))
    .sort((a, b) => importanceOf(a.entry) - importanceOf(b.entry) || a.position - b.position)
    .map((item) => item.entry);

  for (const entry of sorted) lines.push(...renderEntry(entry, files));

  // The last entry leaves a separator behind that has nothing to separate.
  while (lines.length > 0 && (lines[lines.length - 1] === "" || lines[lines.length - 1] === "---")) {
    lines.pop();
  }

  return lines.join("\n") + "\n";
}

/** Render one parsed document, the way render_one does. */
export function renderDoc(doc: SourceDoc, files: FileResolver): string {
  return renderFolder(
    doc.folder,
    doc.generalNotes,
    doc.entries.map((parsed) => parsed.entry),
    files,
  );
}
