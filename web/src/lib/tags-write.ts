/** Add a tag to scripts/common/allowed_tags.toml.
 *
 *  Port of common/lib.py:198 add_tag, which exists in the toolkit but is unreachable -- no
 *  script calls it, and the only invocation is a commented-out line at common/lib.py:305.
 *  So today a new tag means hand-editing the file in two places: the flat `[[tags]]` list
 *  AND at least one `[tags_type]` group. Missing the second is easy and silent.
 *
 *  Like every other write here, this splices: it locates the array to extend and inserts
 *  before its closing bracket, leaving the file's comments and line breaks untouched.
 */

import { parseTOML } from "toml-eslint-parser";
import type { AST } from "toml-eslint-parser";

export class TagWriteError extends Error {}

interface ArrayTarget {
  /** Offset of the closing bracket. */
  closeAt: number;
  isEmpty: boolean;
}

/** Locate the array assigned to `key` inside the named table. */
function findArray(text: string, table: "tags" | "tags_type", key: string): ArrayTarget {
  const ast = parseTOML(text);

  for (const node of ast.body[0].body) {
    if (node.type !== "TOMLTable") continue;

    const resolved = node.resolvedKey;
    const isFlatList = table === "tags" && resolved[0] === "tags" && node.kind === "array";
    const isGroup = table === "tags_type" && resolved[0] === "tags_type" && node.kind === "standard";
    if (!isFlatList && !isGroup) continue;

    for (const item of node.body) {
      if (item.type !== "TOMLKeyValue") continue;
      if (keyName(item) !== key) continue;

      const value = item.value;
      if (value.type !== "TOMLArray") {
        throw new TagWriteError(`${table}.${key} is not an array`);
      }
      return { closeAt: value.range[1] - 1, isEmpty: value.elements.length === 0 };
    }
  }

  throw new TagWriteError(`could not find ${key} in [${table}]`);
}

function keyName(node: AST.TOMLKeyValue): string | null {
  const first = node.key.keys[0];
  if (!first) return null;
  // Bare keys carry `name`, quoted keys carry `value`.
  const name = first.type === "TOMLBare" ? first.name : first.value;
  return typeof name === "string" ? name : null;
}

/** Insert `"tag"` before the closing bracket of the array at `target`. */
function insert(text: string, target: ArrayTarget, tag: string): string {
  const literal = JSON.stringify(tag);
  const addition = target.isEmpty ? literal : `, ${literal}`;
  return text.slice(0, target.closeAt) + addition + text.slice(target.closeAt);
}

/** Add `tag` to the flat vocabulary and to every group in `groups`.
 *
 *  Refuses a case-insensitive clash, because a "llm" alongside "LLM" is exactly the split
 *  the fixed vocabulary exists to prevent -- the same check add_tag makes.
 */
export function addTag(
  text: string,
  tag: string,
  groups: string[],
  existingTags: string[],
): string {
  const clean = tag.trim();
  if (!clean) throw new TagWriteError("no tag given");
  if (groups.length === 0) {
    throw new TagWriteError(`no tag field given for "${clean}" -- it needs at least one`);
  }

  const clash = existingTags.find((existing) => existing.toLowerCase() === clean.toLowerCase());
  if (clash) {
    throw new TagWriteError(`tag "${clash}" already exists -- use it rather than adding "${clean}"`);
  }

  // The flat list first; every group insert shifts offsets, so each is re-located against
  // the text as it stands at that point.
  let out = insert(text, findArray(text, "tags", "tags"), clean);
  for (const group of groups) {
    out = insert(out, findArray(out, "tags_type", group), clean);
  }
  return out;
}
