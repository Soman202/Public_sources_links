/** Port of the id / url / date helpers in scripts/common/lib.py. */

const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+\-.]*$/;

interface SplitUrl {
  scheme: string;
  netloc: string;
  path: string;
  query: string;
  fragment: string;
}

/** Python urllib.parse.urlsplit, enough of it to be faithful for http(s) and for junk.
 *  Tabs, CRs and LFs are dropped first, as CPython does. */
function urlsplit(url: string): SplitUrl {
  let rest = url.replace(/[\t\r\n]/g, "");
  let scheme = "";
  let netloc = "";
  let query = "";
  let fragment = "";

  const colon = rest.indexOf(":");
  if (colon > 0 && SCHEME_CHARS.test(rest.slice(0, colon))) {
    scheme = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }

  if (rest.startsWith("//")) {
    // netloc runs to the first of / ? # after the leading slashes.
    const after = rest.slice(2);
    const stop = after.search(/[/?#]/);
    if (stop === -1) {
      netloc = after;
      rest = "";
    } else {
      netloc = after.slice(0, stop);
      rest = after.slice(stop);
    }
  }

  const hash = rest.indexOf("#");
  if (hash !== -1) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }

  const question = rest.indexOf("?");
  if (question !== -1) {
    query = rest.slice(question + 1);
    rest = rest.slice(0, question);
  }

  return { scheme, netloc, path: rest, query, fragment };
}

/** Python urllib.parse.urlunsplit, for the one shape normalizeUrl calls it with
 *  (empty scheme, empty query, empty fragment). */
function urlunsplitNetlocOnly(netloc: string, path: string): string {
  let url = path;
  if (netloc) {
    if (url && !url.startsWith("/")) url = "/" + url;
    url = "//" + netloc + url;
  }
  return url;
}

/** Port of common/lib.py:112 normalize_url -- strip scheme/www/trailing-slash/query noise
 *  so duplicate URLs compare equal. Note the result keeps the leading "//" for anything
 *  with a host, because that is what urlunsplit produces and the string is used as an
 *  index key and printed in duplicate findings. */
export function normalizeUrl(url: string): string {
  const parts = urlsplit((url ?? "").trim());
  const netloc = stripPrefix(parts.netloc.toLowerCase(), "www.");
  const path = parts.path.replace(/\/+$/, "");
  return urlunsplitNetlocOnly(netloc, path);
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Port of common/lib.py:120 looks_like_url. */
export function looksLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** Port of common/lib.py:90 slugify -- lowercase, non-alphanumerics to hyphens, trimmed. */
export function slugify(title: string): string {
  const slug = (title ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return trimChar(slug, "-");
}

function trimChar(value: string, char: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === char) start += 1;
  while (end > start && value[end - 1] === char) end -= 1;
  return value.slice(start, end);
}

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomCode(length: number, random: () => number): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Port of common/lib.py:96 make_id.
 *
 *  `{F|W}{importance}-{tag[:3]}-{firstWord[:4]}-{6 random}`, e.g. "F3-dev-hell-A1B2C3".
 *  F (has a local file) beats W (web only). The code is re-rolled until unique.
 *
 *  `random` is injectable so the tests can make ids deterministic.
 */
export function makeId(
  title: string,
  tags: string[],
  importance: number,
  hasFile: boolean,
  existingIds: ReadonlySet<string>,
  random: () => number = Math.random,
): string {
  const typeFlag = hasFile ? "F" : "W";
  const tagPart = tags.length > 0 ? slugify(tags[0]).slice(0, 3) : "gen";

  const trimmed = (title ?? "").trim();
  // Python's str.split() on whitespace, then [0]; an all-whitespace title yields "".
  const firstWord = trimmed ? trimmed.split(/\s+/)[0] : "";
  const wordPart = slugify(firstWord).slice(0, 4) || "untl";

  for (;;) {
    const candidate = `${typeFlag}${importance}-${tagPart}-${wordPart}-${randomCode(6, random)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

/** Port of common/lib.py:125 today_iso. Local date, matching Python's date.today(). */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
