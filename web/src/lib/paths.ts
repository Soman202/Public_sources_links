/** Port of update_files.py:49 path_key -- one spelling per file, so `\` vs `/` or letter
 *  case can't make an already-listed file look new.
 *
 *  The Python version resolves against the filesystem via os.path.normcase + Path.resolve().
 *  There is no filesystem here, so this canonicalises the repo-relative path directly:
 *  backslashes to forward slashes, `.`/`..` resolved, lowercased.
 *
 *  This matches Python-on-Windows, which is where the toolkit is actually run. On Linux a
 *  backslash is a legal filename character, so `Path("a\\b").resolve()` would NOT split it
 *  there -- see docs/parity-notes.md. The repo currently holds both separator styles, which
 *  is why every `files` comparison goes through this function rather than comparing raw
 *  strings.
 */
export function pathKey(fileField: string): string {
  return normalizeRepoPath(fileField).toLowerCase();
}

/** Canonical repo-relative POSIX form, preserving case. What new entries are written with. */
export function normalizeRepoPath(fileField: string): string {
  const slashed = (fileField ?? "").trim().replace(/\\/g, "/");

  const parts: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

/** The folder a sources.toml lives in, as a repo-relative POSIX path.
 *  "Tools/Free tools/sources.toml" -> "Tools/Free tools"; a root file -> "". */
export function folderOf(tomlPath: string): string {
  const normalized = normalizeRepoPath(tomlPath);
  const cut = normalized.lastIndexOf("/");
  return cut === -1 ? "" : normalized.slice(0, cut);
}

/** The last path segment of a folder. Python's `path.parent.name`.
 *
 *  Load-bearing asymmetry, faithfully reproduced: validate_sources.py uses the short folder
 *  NAME in findings and in build_index (`path.parent.name`), while export_json.py, search.py
 *  and render_md.py use the FULL relative path (`relative_to(repo_root()).as_posix()`). So
 *  `Tools` and `Tools/Free tools` both report as "Tools" in a finding but stay distinct in
 *  sources.json. Do not "fix" this -- the parity tests depend on it.
 */
export function folderName(folder: string): string {
  const normalized = normalizeRepoPath(folder);
  const cut = normalized.lastIndexOf("/");
  return cut === -1 ? normalized : normalized.slice(cut + 1);
}
