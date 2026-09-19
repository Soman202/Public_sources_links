/** GitHub REST access: reads through the Contents and Trees APIs, writes through the Git
 *  Data API.
 *
 *  Writes go through blob -> tree -> commit -> update ref rather than the Contents API for
 *  one reason: every operation here changes several files at once (a sources.toml, the
 *  regenerated sources.json, that folder's sources.md, sometimes an uploaded PDF), and the
 *  Git Data route puts them in ONE commit. That matches the shape of the commits the
 *  desktop toolkit produces today, and avoids leaving the repo in a half-written state if a
 *  request fails partway.
 *
 *  Reads use the Contents API because it sets CORS headers, which raw.githubusercontent.com
 *  does not. It refuses to return content for files over 1 MB, so anything large is fetched
 *  through the Blobs API instead, or simply linked to GitHub's own viewer.
 */

const API = "https://api.github.com";

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

/** This collection. The branch the toolkit currently lives on. */
export const DEFAULT_REPO: RepoConfig = {
  owner: "Soman202",
  repo: "Public_sources_links",
  branch: "master",
};

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

/** One file to write in a commit. Exactly one of `text` or `base64` is given. */
export interface FileWrite {
  path: string;
  text?: string;
  base64?: string;
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    readonly config: RepoConfig = DEFAULT_REPO,
  ) {}

  private get base(): string {
    return `${API}/repos/${this.config.owner}/${this.config.repo}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.base}${path}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new GitHubError(
        `${response.status} ${response.statusText}${detail ? ` -- ${detail.slice(0, 400)}` : ""}`,
        response.status,
        url,
      );
    }

    return (await response.json()) as T;
  }

  /** The whole repo tree in one call. Backs the Ingest view and every file-existence check. */
  async tree(): Promise<TreeEntry[]> {
    const data = await this.request<{ tree: TreeEntry[]; truncated: boolean }>(
      `/git/trees/${encodeURIComponent(this.config.branch)}?recursive=1`,
    );
    if (data.truncated) {
      throw new GitHubError(
        "the repo tree came back truncated -- it has outgrown a single Trees API call",
        200,
        "/git/trees",
      );
    }
    return data.tree;
  }

  /** A text file's contents. Falls back to the Blobs API past the Contents API's 1 MB cap. */
  async readText(path: string): Promise<string> {
    const data = await this.request<{ content?: string; encoding?: string; sha: string; size: number }>(
      `/contents/${encodePath(path)}?ref=${encodeURIComponent(this.config.branch)}`,
    );

    if (data.content !== undefined && data.encoding === "base64") {
      return decodeBase64(data.content);
    }
    return this.readBlob(data.sha);
  }

  async readBlob(sha: string): Promise<string> {
    const data = await this.request<{ content: string; encoding: string }>(`/git/blobs/${sha}`);
    return decodeBase64(data.content);
  }

  /** Read several text files at once. Missing files come back as undefined rather than
   *  throwing, because the callers legitimately ask for optional ones (a folder's
   *  tags.toml, say). */
  async readMany(paths: string[]): Promise<Map<string, string | undefined>> {
    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          return [path, await this.readText(path)] as const;
        } catch (error) {
          if (error instanceof GitHubError && error.status === 404) {
            return [path, undefined] as const;
          }
          throw error;
        }
      }),
    );
    return new Map(results);
  }

  /** The URL of GitHub's own viewer for a path -- used for PDFs rather than fetching
   *  megabytes of base64 into the page. */
  blobUrl(path: string): string {
    const { owner, repo, branch } = this.config;
    return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encodePath(path)}`;
  }

  /** Write several files as ONE commit. Returns the new commit sha.
   *
   *  `expectedHeadSha`, when given, makes this a compare-and-swap: if the branch moved since
   *  the caller read it -- a commit from the desktop, or from another device -- the write is
   *  refused rather than silently built on stale content.
   */
  async commit(
    files: FileWrite[],
    message: string,
    expectedHeadSha?: string,
  ): Promise<{ sha: string; headSha: string }> {
    if (files.length === 0) throw new Error("commit() needs at least one file");

    const head = await this.head();
    if (expectedHeadSha && head.sha !== expectedHeadSha) {
      throw new GitHubError(
        `the branch moved since this page loaded (expected ${expectedHeadSha.slice(0, 7)}, ` +
          `found ${head.sha.slice(0, 7)}). Reload before writing, so the change is not built ` +
          "on stale content.",
        409,
        "/git/refs",
      );
    }

    const blobs = await Promise.all(
      files.map(async (file) => {
        const body =
          file.base64 !== undefined
            ? { content: file.base64, encoding: "base64" }
            : { content: file.text ?? "", encoding: "utf-8" };

        const blob = await this.request<{ sha: string }>("/git/blobs", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
      }),
    );

    const tree = await this.request<{ sha: string }>("/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: head.treeSha, tree: blobs }),
    });

    const commit = await this.request<{ sha: string }>("/git/commits", {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [head.sha] }),
    });

    await this.request(`/git/refs/heads/${encodeURIComponent(this.config.branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return { sha: commit.sha, headSha: commit.sha };
  }

  /** The branch tip and the tree it points at. */
  async head(): Promise<{ sha: string; treeSha: string }> {
    const ref = await this.request<{ object: { sha: string } }>(
      `/git/ref/heads/${encodeURIComponent(this.config.branch)}`,
    );
    const commit = await this.request<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`);
    return { sha: ref.object.sha, treeSha: commit.tree.sha };
  }

  async viewer(): Promise<{ login: string; avatar_url: string }> {
    return this.request(`${API}/user`);
  }
}

/** Percent-encode each path segment, leaving the separators alone. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** GitHub returns base64 with newlines in it, and the content is UTF-8. */
export function decodeBase64(value: string): string {
  const clean = value.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** UTF-8 safe base64, for sending text or an uploaded file back. */
export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // chunked, so a large PDF doesn't blow the argument limit
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
