/** The collection as one loaded object, and the operations that change it.
 *
 *  Every mutating operation returns the complete set of files to write, so the caller can
 *  send them as ONE commit -- the target sources.toml, the regenerated sources.json and the
 *  affected sources.md, exactly the shape the desktop toolkit's commits have today.
 */

import { DEFAULT_IMPORTANCE, DEFAULT_CHECKED, TOML_FILENAME } from "../schema/schema.generated";
import { buildJson, serializeJson } from "./export-json";
import { GitHubClient, type FileWrite, type TreeEntry } from "./github";
import { makeId, todayIso } from "./id";
import { MD_FILENAME, renderDoc } from "./render-md";
import { normalizeRepoPath, pathKey } from "./paths";
import { loadAllDocs, parseSourceDoc, readTags, readTagTypes, readFolderTags } from "./toml-read";
import { appendEntry, buildFields, deleteEntry, replaceEntry } from "./toml-write";
import type { ParsedEntry, SourceDoc, SourceEntry, UnreadableFile } from "./types";
import {
  canonical,
  fieldNormalize,
  validateEntry,
  validateRepo,
  buildIndex,
  type FileResolver,
  type IndexableEntry,
  type RepoAudit,
} from "./validate";
import { folderName } from "./paths";
import type { Findings } from "./types";

export interface Collection {
  docs: SourceDoc[];
  unreadable: UnreadableFile[];
  tree: TreeEntry[];
  allowedTags: string[];
  tagTypes: Record<string, string[]>;
  /** tags.toml contents under Attachments/, keyed by folder path. */
  folderTags: Map<string, string | undefined>;
  files: FileResolver;
  headSha: string;
  allowedTagsToml: string;
}

const ALLOWED_TAGS_PATH = "scripts/common/allowed_tags.toml";
const ATTACHMENTS = "Attachments";

/** Load everything the app needs in as few round trips as the API allows. */
export async function loadCollection(client: GitHubClient): Promise<Collection> {
  const [tree, head] = await Promise.all([client.tree(), client.head()]);

  const tomlPaths = tree
    .filter((item) => item.type === "blob" && item.path.split("/").pop() === TOML_FILENAME)
    .map((item) => item.path)
    // web/ holds the app itself; it has no sources.toml, but never index it if it ever does.
    .filter((path) => !path.startsWith("web/"))
    .sort();

  const tagsTomlPaths = tree
    .filter(
      (item) =>
        item.type === "blob" &&
        item.path.startsWith(`${ATTACHMENTS}/`) &&
        item.path.split("/").pop() === "tags.toml",
    )
    .map((item) => item.path);

  const contents = await client.readMany([ALLOWED_TAGS_PATH, ...tomlPaths, ...tagsTomlPaths]);

  const allowedTagsToml = contents.get(ALLOWED_TAGS_PATH) ?? "";
  const { docs, unreadable } = loadAllDocs(
    tomlPaths.map((path) => ({ path, text: contents.get(path) ?? "" })),
  );

  const folderTags = new Map<string, string | undefined>();
  for (const path of tagsTomlPaths) {
    folderTags.set(path.slice(0, path.length - "/tags.toml".length), contents.get(path));
  }

  return {
    docs,
    unreadable,
    tree,
    allowedTags: readTags(allowedTagsToml),
    tagTypes: readTagTypes(allowedTagsToml),
    folderTags,
    files: treeResolver(tree),
    headSha: head.sha,
    allowedTagsToml,
  };
}

/** A FileResolver backed by the Git tree listing, standing in for os.stat. */
export function treeResolver(tree: TreeEntry[]): FileResolver {
  const byKey = new Map<string, TreeEntry>();
  for (const item of tree) {
    if (item.type === "blob") byKey.set(pathKey(item.path), item);
  }
  return {
    exists: (fileField) => byKey.has(pathKey(fileField)),
    sizeOf: (fileField) => byKey.get(pathKey(fileField))?.size ?? null,
  };
}

export function allEntries(collection: Collection): Array<{ entry: SourceEntry; folder: string }> {
  return collection.docs.flatMap((doc) =>
    doc.entries.map((parsed) => ({ entry: parsed.entry, folder: doc.folder })),
  );
}

export function existingIds(collection: Collection): Set<string> {
  const ids = new Set<string>();
  for (const doc of collection.docs) {
    for (const parsed of doc.entries) {
      const id = typeof parsed.entry.id === "string" ? parsed.entry.id.trim() : "";
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function audit(collection: Collection): RepoAudit {
  return validateRepo(collection.docs, collection.allowedTags, collection.files);
}

export function folderPaths(collection: Collection): string[] {
  return collection.docs.map((doc) => doc.folder).sort();
}

// --- building an entry ---------------------------------------------------------------------

/** Port of add_source.py:56 fill_defaults -- the fields the tool owns rather than the user. */
export function fillDefaults(entry: SourceEntry): { fields: SourceEntry; filled: string[] } {
  const fields: SourceEntry = { ...entry };
  const filled: string[] = [];

  for (const field of ["urls", "tags", "files"] as const) {
    if (fields[field] === null || fields[field] === undefined) fields[field] = [];
  }

  if (!(typeof fields.importance === "number" && Number.isInteger(fields.importance))) {
    fields.importance = DEFAULT_IMPORTANCE;
    filled.push(`importance -> ${DEFAULT_IMPORTANCE}`);
  }

  if (typeof fields.checked !== "string" || !fields.checked.trim()) {
    fields.checked = DEFAULT_CHECKED;
  }

  if (typeof fields.date_editing !== "string" || !fields.date_editing.trim()) {
    fields.date_editing = todayIso();
    filled.push(`date_editing -> ${fields.date_editing}`);
  }

  return { fields, filled };
}

/** Validate a candidate entry the way add_source.py does: index it AFTER every existing
 *  entry, so a real repeat reports against the existing owner while a unique key resolves
 *  to the candidate itself and is skipped as "the original". */
export function validateCandidate(
  collection: Collection,
  folder: string,
  fields: SourceEntry,
  ignoreKey?: number,
): Findings {
  const candidateKey = -1;

  const indexable: IndexableEntry[] = [];
  for (const doc of collection.docs) {
    const short = folderName(doc.folder);
    for (const parsed of doc.entries) {
      if (parsed.key === ignoreKey) continue; // editing in place: don't collide with itself
      indexable.push({ entry: parsed.entry, folder: short, key: parsed.key });
    }
  }
  indexable.push({ entry: fields, folder: folderName(folder), key: candidateKey });

  // validateEntry already runs fieldValidate over every field, with the
  // `[folder] 'title': ` prefix the findings are expected to carry.
  return validateEntry(
    fields,
    folderName(folder),
    candidateKey,
    buildIndex(indexable),
    collection.allowedTags,
    collection.files,
  );
}

/** Apply every available mechanical correction to a candidate before writing it. */
export function normalizeFields(collection: Collection, fields: SourceEntry): SourceEntry {
  const out: SourceEntry = { ...fields };
  for (const field of Object.keys(out)) {
    const correction = fieldNormalize(field, out[field], collection.allowedTags);
    if (correction !== null) out[field] = correction[0];
  }
  return out;
}

// --- write operations ------------------------------------------------------------------------

export interface WritePlan {
  files: FileWrite[];
  message: string;
  /** The collection as it will be once the commit lands, for optimistic UI. */
  next: Collection;
}

/** Rebuild the derived views for a changed set of documents. */
function regenerate(collection: Collection, docs: SourceDoc[], touched: Set<string>): FileWrite[] {
  const files: FileWrite[] = [];

  for (const doc of docs) {
    if (!touched.has(doc.path)) continue;
    files.push({ path: doc.path, text: doc.text });
    files.push({
      path: doc.folder ? `${doc.folder}/${MD_FILENAME}` : MD_FILENAME,
      text: renderDoc(doc, collection.files),
    });
  }

  files.push({ path: "sources.json", text: serializeJson(buildJson(docs)) });
  return files;
}

function withDoc(collection: Collection, updated: SourceDoc): Collection {
  return {
    ...collection,
    docs: collection.docs.map((doc) => (doc.path === updated.path ? updated : doc)),
  };
}

/** Add one source to a folder. Mirrors add_source.py, minus the y/N gates. */
export function planAdd(
  collection: Collection,
  folder: string,
  entry: SourceEntry,
  attachment?: { path: string; base64: string },
): WritePlan {
  const tomlPath = folder ? `${folder}/${TOML_FILENAME}` : TOML_FILENAME;
  const doc = collection.docs.find((item) => item.path === tomlPath);
  if (!doc) throw new Error(`no ${TOML_FILENAME} at ${tomlPath} -- create that folder's file first`);

  const { fields } = fillDefaults(entry);
  if (typeof fields.id !== "string" || !fields.id.trim()) {
    fields.id = makeId(
      typeof fields.title === "string" ? fields.title : "",
      (Array.isArray(fields.tags) ? fields.tags : []).filter(
        (tag): tag is string => typeof tag === "string",
      ),
      fields.importance as number,
      Array.isArray(fields.files) && fields.files.length > 0,
      existingIds(collection),
    );
  }

  const text = appendEntry(doc.text, buildFields(fields as Record<string, unknown>));
  const updated = parseSourceDoc(doc.path, text);
  const next = withDoc(collection, updated);

  const files = regenerate(next, next.docs, new Set([doc.path]));
  if (attachment) files.unshift({ path: attachment.path, base64: attachment.base64 });

  return {
    files,
    message: `added ${String(fields.title ?? "source")}`,
    next,
  };
}

/** Change one existing entry in place. Mirrors edite_source.py's merge: only the fields
 *  given are replaced, and date_editing is bumped. */
export function planEdit(
  collection: Collection,
  target: { doc: SourceDoc; parsed: ParsedEntry },
  changes: SourceEntry,
): WritePlan {
  const merged: SourceEntry = { ...target.parsed.entry, ...changes, date_editing: todayIso() };

  const text = replaceEntry(
    target.doc.text,
    target.parsed.range,
    buildFields(merged as Record<string, unknown>),
  );
  const updated = parseSourceDoc(target.doc.path, text);
  const next = withDoc(collection, updated);

  return {
    files: regenerate(next, next.docs, new Set([target.doc.path])),
    message: `edited ${String(merged.title ?? "source")}`,
    next,
  };
}

/** Remove one entry. Recoverable only through git, which the UI says out loud. */
export function planDelete(
  collection: Collection,
  target: { doc: SourceDoc; parsed: ParsedEntry },
): WritePlan {
  const text = deleteEntry(target.doc.text, target.parsed.range);
  const updated = parseSourceDoc(target.doc.path, text);
  const next = withDoc(collection, updated);

  return {
    files: regenerate(next, next.docs, new Set([target.doc.path])),
    message: `removed ${String(target.parsed.entry.title ?? "source")}`,
    next,
  };
}

/** Apply every mechanical fix the audit flagged, across the whole repo. Mirrors
 *  validate_sources.py:290 apply_small_fixes. */
export function planFixes(collection: Collection): WritePlan & { fixed: number } {
  let fixed = 0;
  const touched = new Set<string>();
  let docs = collection.docs;

  for (const doc of collection.docs) {
    let text = doc.text;
    let changed = false;

    // Splice from the end, so earlier ranges stay valid as the text shifts.
    const entries = [...doc.entries].sort((a, b) => b.range[0] - a.range[0]);

    for (const parsed of entries) {
      const fields: SourceEntry = { ...parsed.entry };
      let entryChanged = false;

      for (const field of Object.keys(fields)) {
        const correction = fieldNormalize(field, fields[field], collection.allowedTags);
        if (correction === null) continue;
        fields[field] = correction[0];
        fixed += 1;
        entryChanged = true;
      }

      if (!("importance" in fields)) {
        fields.importance = DEFAULT_IMPORTANCE;
        fixed += 1;
        entryChanged = true;
      }

      if (entryChanged) {
        text = replaceEntry(text, parsed.range, buildFields(fields as Record<string, unknown>));
        changed = true;
      }
    }

    if (changed) {
      const updated = parseSourceDoc(doc.path, text);
      docs = docs.map((item) => (item.path === doc.path ? updated : item));
      touched.add(doc.path);
    }
  }

  const next = { ...collection, docs };
  return {
    files: regenerate(next, docs, touched),
    message: `applied ${fixed} mechanical fix${fixed === 1 ? "" : "es"}`,
    next,
    fixed,
  };
}

// --- ingest (update_files.py) -------------------------------------------------------------

export interface IngestCandidate {
  path: string;
  entry: SourceEntry;
  tags: string[];
}

export interface IngestReport {
  candidates: IngestCandidate[];
  skipped: string[];
  invalidTagFiles: string[];
  emptyTagFiles: string[];
  alreadyListed: number;
}

/** Port of update_files.py -- every file under Attachments/ that no sources.toml mentions. */
export function planIngestReport(collection: Collection): IngestReport {
  const canonicalTag = (tag: string) => canonical(tag, collection.allowedTags);

  const listed = new Set<string>();
  for (const doc of collection.docs) {
    for (const parsed of doc.entries) {
      for (const file of Array.isArray(parsed.entry.files) ? parsed.entry.files : []) {
        if (typeof file === "string" && file.trim()) listed.add(pathKey(file));
      }
    }
  }

  const tagsByFolder = new Map<string, ReturnType<typeof readFolderTags>>();
  const invalidTagFiles: string[] = [];
  const emptyTagFiles: string[] = [];

  for (const [folder, text] of collection.folderTags) {
    const result = readFolderTags(`${folder}/tags.toml`, text, canonicalTag);
    tagsByFolder.set(folder, result);
    if (result.problem) invalidTagFiles.push(result.problem);
    if (result.warning) emptyTagFiles.push(result.warning);
  }

  const skipped: string[] = [];
  const candidates: IngestCandidate[] = [];
  const ids = existingIds(collection);
  let alreadyListed = 0;

  const attachments = collection.tree
    .filter((item) => item.type === "blob" && item.path.startsWith(`${ATTACHMENTS}/`))
    .map((item) => item.path)
    .filter((path) => {
      const name = path.split("/").pop() ?? "";
      return name !== TOML_FILENAME && name !== MD_FILENAME && name !== "tags.toml" && !name.startsWith(".");
    })
    .sort();

  for (const path of attachments) {
    if (listed.has(pathKey(path))) {
      alreadyListed += 1;
      continue;
    }

    // Tags from every folder between Attachments/ and the file, outermost first, deduped.
    // Order matters: tags[0] feeds the entry's id.
    const tags: string[] = [];
    const problems: string[] = [];
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join("/");
      const result = tagsByFolder.get(folder);
      if (!result) continue;
      if (result.problem) problems.push(result.problem);
      for (const tag of result.tags) if (!tags.includes(tag)) tags.push(tag);
    }

    if (problems.length > 0) {
      skipped.push(`${path}: ${problems.join("; ")}`);
      continue;
    }

    const title = (segments[segments.length - 1] ?? "")
      .replace(/\.[^.]+$/, "")
      .replace(/_/g, " ")
      .trim();

    const entry: SourceEntry = {
      title,
      importance: DEFAULT_IMPORTANCE,
      description: `Auto-added by update_files.py from ${path}.`,
      urls: [],
      tags,
      checked: DEFAULT_CHECKED,
      files: [normalizeRepoPath(path)],
      platform: "",
      cost: "",
      date_editing: todayIso(),
      notes: "",
    };
    entry.id = makeId(title, tags, DEFAULT_IMPORTANCE, true, ids);
    ids.add(entry.id as string);

    candidates.push({ path, entry, tags });
  }

  return { candidates, skipped, invalidTagFiles, emptyTagFiles, alreadyListed };
}

/** Commit a chosen subset of the ingest candidates to Attachments/sources.toml. */
export function planIngest(collection: Collection, chosen: IngestCandidate[]): WritePlan {
  const tomlPath = `${ATTACHMENTS}/${TOML_FILENAME}`;
  const doc = collection.docs.find((item) => item.path === tomlPath);
  if (!doc) throw new Error(`no ${tomlPath} -- create it first`);

  let text = doc.text;
  for (const candidate of chosen) {
    text = appendEntry(text, buildFields(candidate.entry as Record<string, unknown>));
  }

  const updated = parseSourceDoc(doc.path, text);
  const next = withDoc(collection, updated);

  return {
    files: regenerate(next, next.docs, new Set([doc.path])),
    message: `added ${chosen.length} attachment${chosen.length === 1 ? "" : "s"}`,
    next,
  };
}
