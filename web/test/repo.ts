/** Test-only access to the real repo, plus the Python oracle.
 *
 *  Reads only. Nothing here writes to the repo -- the tests exist to prove the port matches
 *  the Python, not to change anything it reads.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

import { loadAllDocs, readTags, readTagTypes, type RawFile } from "../src/lib/toml-read";
import { pathKey } from "../src/lib/paths";
import type { FileResolver } from "../src/lib/validate";

export const WEB_ROOT = resolve(HERE, "..");
export const REPO_ROOT = resolve(WEB_ROOT, "..");

/** Directories Python's `repo_root().glob("**\/sources.toml")` would walk but that hold
 *  nothing relevant -- skipped here only to keep the walk fast. */
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", "dist"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      walk(join(dir, item.name), out);
    } else if (item.isFile()) {
      out.push(join(dir, item.name));
    }
  }
  return out;
}

let cachedFiles: string[] | null = null;

/** Every file in the repo, as repo-relative POSIX paths. */
export function repoFiles(): string[] {
  if (cachedFiles === null) {
    cachedFiles = walk(REPO_ROOT).map((path) => relative(REPO_ROOT, path).replace(/\\/g, "/"));
  }
  return cachedFiles;
}

/** Every sources.toml, mirroring Python's glob. */
export function sourceTomlPaths(): string[] {
  return repoFiles()
    .filter((path) => path.endsWith("/sources.toml") || path === "sources.toml")
    .filter((path) => !path.startsWith("web/"))
    .sort();
}

export function readRepoFile(repoPath: string): string {
  return readFileSync(join(REPO_ROOT, repoPath), "utf8");
}

/** The repo's sources.toml files, ready for loadAllDocs. */
export function rawSourceFiles(): RawFile[] {
  return sourceTomlPaths().map((path) => ({ path, text: readRepoFile(path) }));
}

export function loadRepo() {
  return loadAllDocs(rawSourceFiles());
}

export function allowedTags(): string[] {
  return readTags(readRepoFile("scripts/common/allowed_tags.toml"));
}

export function tagTypes(): Record<string, string[]> {
  return readTagTypes(readRepoFile("scripts/common/allowed_tags.toml"));
}

/** A FileResolver backed by the real working tree, so file-existence and size findings
 *  match what Python's os.stat sees. Lookups go through pathKey, which is what makes the
 *  repo's backslash-separated `files` values resolve. */
export function realFileResolver(): FileResolver {
  const byKey = new Map<string, string>();
  for (const path of repoFiles()) byKey.set(pathKey(path), path);

  return {
    exists: (fileField) => byKey.has(pathKey(fileField)),
    sizeOf: (fileField) => {
      const actual = byKey.get(pathKey(fileField));
      if (!actual) return null;
      return statSync(join(REPO_ROOT, actual)).size;
    },
  };
}

/** Run the Python toolkit and return what it computed. The oracle writes nothing. */
export function oracle<T>(command: string, ...args: string[]): T {
  const stdout = execFileSync(
    "uv",
    ["run", "--with", "tomlkit>=0.12", "python", "scripts/py-oracle.py", command, ...args],
    { cwd: WEB_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as T;
}
