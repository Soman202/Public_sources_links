"""List every file under Attachments/ that no sources.toml mentions yet, in Attachments/sources.toml.

Each new file gets an entry built for it: the title comes from the file name, and the tags
are inherited from the tags.toml of every folder between Attachments/ and the file, outermost
first. Everything found is reported before anything is written, then one y/N adds the batch.

HOW TO USE
    Drop files into Attachments/ (any depth), give their folders a tags.toml such as
    tags = ["book", "math"], then run it. Nothing to edit in this file.

    A tags.toml holding a tag that isn't in scripts/common/allowed_tags.toml is reported and
    every file below it is skipped -- fix the tag (or add it to the vocabulary) and re-run.
    A file with no tags anywhere on its path is still added, with tags = [], and a warning;
    validate_sources keeps flagging it until you tag it with edite_source.

Run: python scripts/update_files.py
"""

from __future__ import annotations

import os
from pathlib import Path

import export_json
import render_md
from add_source import append_entry, existing_ids
from common.lib import (
    DEFAULT_CHECKED,
    DEFAULT_IMPORTANCE,
    TOML_FILENAME,
    as_list,
    confirm,
    load_all_docs,
    load_toml,
    make_id,
    repo_root,
    today_iso,
)
from validate_sources import allowed_tags, build_index, canonical, validate

ATTACHMENTS = "Attachments"
TAGS_FILENAME = "tags.toml"
SKIP_NAMES = {TOML_FILENAME, render_md.MD_FILENAME, TAGS_FILENAME}

# The one finding an untagged entry is allowed to have -- untagged files are added on purpose.
NO_TAGS_FINDING = "missing required field 'tags'"


def path_key(file_field: str) -> str:
    """One spelling per file on disk, so \\ vs /, letter case, or an absolute vs a
    repo-relative path can't make an already-listed file look new."""
    return os.path.normcase(str((repo_root() / file_field.strip()).resolve()))


def listed_files(docs: dict) -> set[str]:
    return {
        path_key(file_field)
        for doc in docs.values()
        for entry in doc.get("source", [])
        for file_field in as_list(entry.get("files"))
        if isinstance(file_field, str) and file_field.strip()
    }


def read_folder_tags(folder: Path) -> tuple[list[str], str | None, str | None]:
    """(tags, problem, warning) for one folder's tags.toml.

    A problem means the tags can't be trusted, so every file below the folder is skipped. A
    warning means the file is there but adds nothing. No tags.toml at all is neither.
    """
    path = folder / TAGS_FILENAME
    if not path.is_file():
        return [], None, None

    where = path.relative_to(repo_root()).as_posix()
    try:
        doc = load_toml(path)
    except Exception as exc:
        return [], f"{where}: {exc}", None

    raw = doc.get("tags")
    if not raw:
        return [], None, f"{where}: empty or no 'tags' key -- adds no tags"
    if not isinstance(raw, list) or not all(isinstance(tag, str) for tag in raw):
        return [], f"{where}: tags should be a list of strings, got {raw!r}", None

    unknown = [tag for tag in raw if canonical(tag, allowed_tags()) is None]
    if unknown:
        return [], f"{where}: tags not in allowed_tags.toml: {unknown!r}", None

    return [canonical(tag, allowed_tags()) for tag in raw], None, None


def inherited_tags(file_path: Path, root: Path, tags_by_folder: dict) -> tuple[list[str], list[str]]:
    """Tags from every folder between root and the file, outermost first, deduped.

    Returns (tags, problems). Order matters -- tags[0] feeds the entry's id -- so the outer
    folder's tags lead, the way a collection's tags.toml lists its own name first.
    """
    tags, problems = [], []
    for folder in reversed(file_path.parents):
        if folder != root and root not in folder.parents:
            continue
        folder_tags, problem, _ = tags_by_folder[folder]
        if problem:
            problems.append(problem)
        for tag in folder_tags:
            if tag not in tags:
                tags.append(tag)
    return tags, problems


def build_entry(file_path: Path, tags: list[str], ids: set[str]) -> dict:
    relative = file_path.relative_to(repo_root()).as_posix()
    title = file_path.stem.replace("_", " ").strip()
    entry = {
        "title": title,
        "importance": DEFAULT_IMPORTANCE,
        "description": f"Auto-added by update_files.py from {relative}.",
        "urls": [],
        "tags": tags,
        "checked": DEFAULT_CHECKED,
        "files": [relative],
        "platform": "",
        "cost": "",
        "date_editing": today_iso(),
        "notes": "",
    }
    entry["id"] = make_id(title, tags, DEFAULT_IMPORTANCE, True, ids)
    ids.add(entry["id"])
    return entry


def print_section(heading: str, lines: list[str]) -> None:
    if lines:
        print(f"== {heading} ({len(lines)}) ==")
        for line in lines:
            print(f"  - {line}")
        print()


def update_files() -> bool:
    """Find unlisted attachments, report everything, then add them all if confirmed."""
    root = repo_root() / ATTACHMENTS
    target = root / TOML_FILENAME
    target_name = target.relative_to(repo_root()).as_posix()

    if not target.is_file():
        print(f"No {TOML_FILENAME} at {target} -- create it first.")
        return False

    docs, unreadable = load_all_docs()
    if unreadable:
        # A file that won't parse hides whatever it lists, so "not listed yet" can't be trusted.
        print_section("UNREADABLE sources.toml -- fix these first, nothing was added", unreadable)
        return False

    tags_by_folder = {
        folder: read_folder_tags(folder)
        for folder in [root, *sorted(path for path in root.rglob("*") if path.is_dir())]
    }
    listed = listed_files(docs)
    ids = existing_ids(docs)

    candidates, skipped, already_listed = [], [], 0
    for file_path in sorted(root.rglob("*")):
        if not file_path.is_file() or file_path.name in SKIP_NAMES or file_path.name.startswith("."):
            continue
        if path_key(str(file_path)) in listed:
            already_listed += 1
            continue
        tags, problems = inherited_tags(file_path, root, tags_by_folder)
        if problems:
            skipped.append(f"{file_path.relative_to(repo_root()).as_posix()}: {'; '.join(problems)}")
            continue
        candidates.append(build_entry(file_path, tags, ids))

    # Candidates are indexed after every existing entry, so a repeat -- against the repo or
    # within this batch -- reports on the later one, exactly as add_source does for one entry.
    index = build_index({**docs, root / "__candidates__": {"source": candidates}})
    to_add, warnings = [], []
    for entry in candidates:
        structural, consistency, convention = validate(entry, ATTACHMENTS, index)
        blocking = [finding for finding in structural + consistency if not finding.endswith(NO_TAGS_FINDING)]
        if blocking:
            skipped.append(f"{entry['files'][0]}: {'; '.join(blocking)}")
        else:
            to_add.append(entry)
            warnings.extend(convention)

    print_section("INVALID tags.toml -- files below these are skipped",
                  [problem for _, problem, _ in tags_by_folder.values() if problem])
    print_section("EMPTY tags.toml", [warning for _, _, warning in tags_by_folder.values() if warning])
    print_section("SKIPPED FILES", skipped)
    print_section("WARNINGS", warnings)
    print_section(f"TO ADD to {target_name}", [
        f"{entry['files'][0]}  tags: {', '.join(entry['tags']) if entry['tags'] else 'NO TAGS'}"
        for entry in to_add
    ])
    print(f"Already listed: {already_listed}")

    if not to_add:
        print("Nothing new to add.")
        return False

    if not confirm(f"Add {len(to_add)} source(s) to {target_name}?"):
        print("Nothing added.")
        return False

    for entry in to_add:
        append_entry(target, entry)
    print(f"Added {len(to_add)} source(s).")

    for entry in to_add:
        if not entry["tags"]:
            print(f"  WARNING: {entry['files'][0]} written with no tags -- "
                  "validate_sources will flag it until you tag it with edite_source.")

    export_json.main()
    print(f"Wrote {render_md.render_one(target).relative_to(repo_root())}")
    return True


def main() -> None:
    update_files()


if __name__ == "__main__":
    main()
