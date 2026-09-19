"""Shared helpers for the sources toolkit. Import from other scripts, don't copy-paste."""
from __future__ import annotations

from pathlib import Path
from datetime import date
from urllib.parse import urlsplit, urlunsplit
import random
import re
import string
import sys

import tomlkit

# --- constants ---
TOML_FILENAME = "sources.toml"
TAGS_FILEAME = "allowed_tags.toml"
FIELD_ORDER = ["id", "title", "importance", 
               "description", "urls", "tags", "checked", "files", "platform", 
               "cost", "date_editing", "notes"]
REQUIRED_FIELDS = ["title", "description", "tags", "checked", "date_editing"]
CHECKED_VALUES = ["fully checked", "checking", "partially checked",
                  "slightly checked", "first look", "No"]

FILE_SIZE_WARN_BYTES = 10*1024*1024  # convention-only threshold for "this local file is big" warnings
DEFAULT_IMPORTANCE = 9   # what an entry with no importance gets; lower = higher priority
DEFAULT_CHECKED = "No"   # what a blank "checked" becomes; must be one of CHECKED_VALUES

MAX_FIELD_VALUE = 250        # length cap for every short text field
MAX_DESCRIPTION_VALUE = 10000  # description gets a much longer leash

# field -> (expected python type, max length or None). The table field_validate reads.
FIELD_SPEC = {
    "id": (str, MAX_FIELD_VALUE),
    "title": (str, MAX_FIELD_VALUE),
    "importance": (int, None),
    "description": (str, MAX_DESCRIPTION_VALUE),
    "urls": (list, None),
    "tags": (list, None),
    "checked": (str, MAX_FIELD_VALUE),
    "files": (list, None),
    "platform": (str, MAX_FIELD_VALUE),
    "cost": (str, MAX_FIELD_VALUE),
    "date_editing": (str, MAX_FIELD_VALUE),
    "notes": (str, MAX_DESCRIPTION_VALUE),
}


def repo_root() -> Path:
    """Anchor everything else off this file's location, not cwd."""
    return Path(__file__).parents[2]


def find_source_files() -> list[Path]:
    """Walk repo_root() and return every per-folder TOML file."""
    return list(repo_root().glob(f'**/{TOML_FILENAME}'))


def load_toml(path: Path):
    """Use tomlkit (not toml/tomllib) so comments/formatting survive a round trip."""
    return tomlkit.parse(path.read_text(encoding="utf-8"))


def save_toml(path: Path, doc) -> None:
    """Write a tomlkit document back to disk.

    tomlkit doesn't reliably keep a blank line before a rebuilt or appended [[source]]
    table, so re-insert one -- these files are hand-edited and entries need to stay
    visually separated.
    """
    text = re.sub(r"\n+(\[\[source\]\])", r"\n\n\1", tomlkit.dumps(doc))
    path.write_text(text, encoding="utf-8")


def load_all_docs() -> tuple[dict, list[str]]:
    """Parse every sources.toml in the repo.

    Returns (docs keyed by path, one message per file that wouldn't parse). Never raises --
    a broken file is something for the caller to report, not something to end the run.
    """
    docs, unreadable = {}, []
    for path in find_source_files():
        try:
            docs[path] = load_toml(path)
        except Exception as exc:
            # tomlkit's message already carries line and column -- keep it verbatim.
            unreadable.append(f"{path.relative_to(repo_root()).as_posix()}: {exc}")
    return docs, unreadable


def slugify(title: str) -> str:
    """Turn a title into an id: lowercase, spaces -> hyphens, strip weird chars."""
    slug = re.sub(r"[^a-z0-9]+", "-", title.strip().lower())
    return slug.strip("-")


def make_id(title: str, tags: list[str], importance: int, has_file: bool, existing_ids: set[str]) -> str:
    """Build a short id: {type}{importance}-{tag}-{word}-{random code}, e.g. "F3-dev-hell-A1B2C3".
    type is "F" (offline/file) or "W" (online/web) - offline wins when an entry has both a file and a url.
    The random code is re-rolled against existing_ids until it's unique.
    """
    type_flag = "F" if has_file else "W"
    tag_part = slugify(tags[0])[:3] if tags else "gen"
    first_word = title.strip().split()[0] if title.strip() else ""
    word_part = slugify(first_word)[:4] or "untl"

    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        candidate = f"{type_flag}{importance}-{tag_part}-{word_part}-{code}"
        if candidate not in existing_ids:
            return candidate

def normalize_url(url: str) -> str:
    """Strip scheme/www/trailing-slash/query noise so duplicate URLs compare equal."""
    parts = urlsplit(url.strip())
    netloc = parts.netloc.lower().removeprefix("www.")
    path = parts.path.rstrip("/")
    return urlunsplit(("", netloc, path, "", ""))


def looks_like_url(s: str) -> bool:
    """True if s starts with http:// or https://."""
    return s.startswith(("http://", "https://"))


def today_iso() -> str:
    """Today's date as YYYY-MM-DD."""
    return date.today().isoformat()

def tags_path() -> Path:
    return repo_root() / "scripts" / "common" / TAGS_FILEAME


def read_tags() -> list[str]:
    """Reads current allowed_tags.toml file and give back the list of allowed tags."""
    doc = load_toml(tags_path())
    return list(doc['tags'][0]['tags'])


def read_tag_types() -> dict[str, list[str]]:
    """The [tags_type] groupings from allowed_tags.toml, as plain lists.

    A tag deliberately belongs to several fields at once ("LLM" is both a CS tag and a
    tool tag), so these overlap and are a browsing aid only -- read_tags() stays the one
    vocabulary the validator checks against.
    """
    doc = load_toml(tags_path())
    return {field: list(tags) for field, tags in doc["tags_type"].items()}


def confirm(question: str) -> bool:
    return input(f"\n{question} [y/N] ").strip().lower() == "y"


def tag_help(tag_field=None) -> list[str]:
    """Show the tags available in one field or in every field, picking interactively if not given."""
    fields = read_tag_types()

    if tag_field is None:
        while True:
            route = input("\nShow (0) all fields or (1) a specific field? ").strip()
            if route in ("0", "1"):
                break
            print("Please enter 0 or 1.")

        if route == "0":
            for name, tags in fields.items():
                print(f"  {name:<12}: {', '.join(tags)}")
            return []

        tags = []
        while True:
            print("\nTag fields:")
            for name, field_tags in fields.items():
                print(f"  {name:<12} ({len(field_tags)})")
            tag_field = input("\nWhich field? ").strip()

            if tag_field not in fields:
                print(f"No such tag field: {tag_field!r}. Pick one of: {', '.join(fields)}")
                tags = []
            else:
                tags = fields[tag_field]
                print(f"\nTags in {tag_field!r}: {', '.join(tags)}")

            if input("\nAnother field? [y/N] ").strip().lower() != "y":
                break

        return tags

    if tag_field not in fields:
        print(f"No such tag field: {tag_field!r}. Pick one of: {', '.join(fields)}")
        return []

    tags = fields[tag_field]
    print(f"\nTags in {tag_field!r}: {', '.join(tags)}")
    return tags


def add_tag(tag: str, tag_fields: list[str]) -> bool:
    """Add a new tag to the allowed vocabulary and file it under the given fields."""
    tag = (tag or "").strip()
    if not tag:
        print("No tag given.")
        return False

    doc = load_toml(tags_path())
    existing = list(doc["tags"][0]["tags"])

    # Case-insensitive, because a "llm" alongside "LLM" is exactly the split the fixed
    # vocabulary exists to prevent.
    clash = next((t for t in existing if t.lower() == tag.lower()), None)
    if clash is not None:
        print(f"Tag {clash!r} already exists -- use it rather than adding {tag!r}.")
        return False

    unknown = [field for field in tag_fields if field not in doc["tags_type"]]
    if unknown:
        print(f"Unknown tag field(s): {unknown!r}. Pick from: {', '.join(doc['tags_type'])}")
        return False

    if not tag_fields:
        print(f"No tag field given for {tag!r} -- it needs at least one.")
        return False

    print(f"\nAdd tag {tag!r} to the allowed list, filed under: {', '.join(tag_fields)}")
    if not confirm("Write it to allowed_tags.toml?"):
        print("Tag not added.")
        return False

    doc["tags"][0]["tags"].append(tag)
    for field in tag_fields:
        doc["tags_type"][field].append(tag)
    save_toml(tags_path(), doc)

    # The validator memoizes the vocabulary, so a tag added mid-run would otherwise still
    # read as unknown. Checked through sys.modules rather than imported: validate_sources
    # imports this file, and it isn't even on the path when lib.py is run on its own -- and
    # if it was never loaded, there is no cache to invalidate anyway.
    validator = sys.modules.get("validate_sources")
    if validator is not None:
        validator.reset_allowed_tags_cache()

    print(f"Added {tag!r}.")
    return True

def iter_all_entries():
    """Yield (entry, folder_name, file_path) for every source in the whole repo."""
    for path in find_source_files():
        doc = load_toml(path)
        folder = path.parent.relative_to(repo_root()).as_posix()
        for entry in doc.get("source", []):
            yield entry, folder, path


def as_list(value) -> list:
    """Iterate a list field defensively.

    The validator already reports a wrong type; without this, a mistyped `urls = "http://a"`
    would be walked character by character by every consumer.
    """
    return value if isinstance(value, list) else []


def entry_label(entry) -> str:
    """A human-readable handle for an entry, so findings stay readable even without a title."""
    return (entry.get("title") or "").strip() or "<untitled entry>"


def has_location(entry) -> bool:
    """A source needs at least one url or one file - never neither."""
    return bool(entry.get("urls")) or bool(entry.get("files"))


def file_missing_problem(file_field: str) -> str | None:
    """Return a problem string if file_field is set but doesn't resolve on disk; else None."""
    file_field = (file_field or "").strip()
    if not file_field:
        return None
    if not (repo_root() / file_field).is_file():
        return f"file does not exist on disk: {file_field!r}"
    return None


def file_size_problem(file_field: str) -> str | None:
    """Return a warning string if file_field resolves but is over FILE_SIZE_WARN_BYTES; else None."""
    file_field = (file_field or "").strip()
    if not file_field:
        return None
    path = repo_root() / file_field
    if not path.is_file():
        return None
    size = path.stat().st_size
    if size > FILE_SIZE_WARN_BYTES:
        mb = FILE_SIZE_WARN_BYTES // (1024 * 1024)
        return f"file is {size / (1024 * 1024):.1f}MB, over the {mb}MB convention guideline: {file_field!r}"
    return None


def entry_to_plain_dict(entry) -> dict:
    """Drop out of tomlkit's item types into plain python values."""
    return {k: (list(v) if isinstance(v, (list, tomlkit.items.Array)) else v) for k, v in entry.items()}


if __name__ =="__main__":
    tag_help()
    #add_tag("lectures", ["data", "format"])