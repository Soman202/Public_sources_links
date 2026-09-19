"""Add one new source to a folder's sources.toml, checking it before anything is written.

Nothing is written until you say so. The entry is checked against the same validator the
repo-wide audit uses, so a bad entry is refused here rather than discovered later.

HOW TO USE
    Edit the two constants near the bottom of this file -- TARGET_FOLDER (which folder the
    source belongs to) and ENTRY (the source itself) -- then run it. Leave id and
    date_editing out; both are filled in for you. An entry needs a title, a description,
    at least one tag, and at least one url or file.

    If a source is a local file, put the file in the repo yourself first and reference it
    by its repo-relative path -- this script never creates or copies files.

Run: python scripts/add_source.py
"""

from __future__ import annotations

from pathlib import Path

import tomlkit

import export_json
import render_md
from common.lib import (
    DEFAULT_IMPORTANCE,
    TOML_FILENAME,
    confirm,
    load_all_docs,
    load_toml,
    make_id,
    repo_root,
    save_toml,
    tag_help,
    today_iso,
)
from validate_sources import (
    build_index,
    build_table,
    field_normalize,
    field_validate,
    order_fields,
    validate,
)

LIST_FIELDS = ("urls", "tags", "files")


def blank(value) -> bool:
    """True for anything that isn't a non-empty string -- ints included, so nothing here
    calls .strip() on a mistyped field before the validator can report the type."""
    return not (isinstance(value, str) and value.strip())


def fill_defaults(entry: dict) -> tuple[dict, list[str]]:
    """Fill in the fields this script owns rather than the user: blank lists, date, rank."""
    fields = dict(entry)
    filled = []

    for field in LIST_FIELDS:
        if fields.get(field) is None:
            fields[field] = []

    if not isinstance(fields.get("importance"), int):
        fields["importance"] = DEFAULT_IMPORTANCE
        filled.append(f"importance -> {DEFAULT_IMPORTANCE}")

    if blank(fields.get("date_editing")):
        fields["date_editing"] = today_iso()
        filled.append(f"date_editing -> {fields['date_editing']}")

    return fields, filled


def type_problems(fields: dict, folder: str) -> list[str]:
    """Field-level checks that have to pass before the entry can even be indexed.

    build_index calls .strip() and .lower() on an entry's title, urls and files, so a value
    of the wrong type raises there instead of being reported. Running field_validate first
    keeps a mistyped field a finding rather than a traceback.
    """
    title = fields.get("title")
    label = title.strip() if not blank(title) else "<untitled entry>"

    return [
        f"[{folder}] {label!r}: {problem}"
        for problem in (field_validate(field, value) for field, value in fields.items())
        if problem
    ]


def existing_ids(docs: dict) -> set[str]:
    return {
        (entry.get("id") or "").strip()
        for doc in docs.values()
        for entry in doc.get("source", [])
        if (entry.get("id") or "").strip()
    }


def show(fields: dict) -> None:
    for key, value in order_fields(fields).items():
        print(f"  {key:<13} {value!r}")


def append_entry(file_path: Path, fields: dict) -> None:
    doc = load_toml(file_path)
    if doc.get("source") is None:
        doc["source"] = tomlkit.aot()
    doc["source"].append(build_table(order_fields(fields)))
    save_toml(file_path, doc)


def add_entry(entry: dict, file_path: Path) -> bool:
    """Validate one new entry, then append it and refresh the derived views if confirmed."""
    fields, filled = fill_defaults(entry)

    if not fields["tags"]:
        print("This entry has no tags. Pick one from a field below, set tags, and re-run.\n")
        tag_help()
        return False

    if not file_path.is_file():
        print(f"No {TOML_FILENAME} at {file_path} -- create that folder's file first.")
        return False

    docs, unreadable = load_all_docs()
    for failure in unreadable:
        print(f"  skipped (unreadable): {failure}")

    if blank(fields.get("id")):
        fields["id"] = make_id(
            fields["title"] if isinstance(fields.get("title"), str) else "",
            [tag for tag in fields["tags"] if isinstance(tag, str)],
            fields["importance"],
            bool(fields["files"]),
            existing_ids(docs),
        )
        filled.append(f"id -> {fields['id']}")

    if filled:
        print("Filled in: " + ", ".join(filled))

    folder = file_path.parent.name

    mistyped = type_problems(fields, folder)
    if mistyped:
        print()
        print(f"Cannot add this entry -- {len(mistyped)} problem(s):")
        for problem in mistyped:
            print(f"  - {problem}")
        return False

    # Indexing the candidate *after* every existing entry is what makes entry_similar
    # behave: a real repeat reports (an existing entry is the first occurrence), while a
    # unique key resolves to the candidate itself and is skipped as "the original".
    index = build_index({**docs, file_path.parent / "__candidate__": {"source": [fields]}})
    structural, consistency, convention = validate(fields, folder, index)

    if structural or consistency:
        print(f"\nCannot add this entry -- {len(structural) + len(consistency)} problem(s):")
        for finding in structural + consistency:
            print(f"  - {finding}")
        return False

    if convention:
        print(f"\n{len(convention)} small issue(s):")
        for finding in convention:
            print(f"  - {finding}")

        if any("(fixable)" in finding for finding in convention):
            if not confirm("Apply these corrections and continue?"):
                print("Nothing added. Correct the entry and re-run.")
                return False
            for field in list(fields):
                correction = field_normalize(field, fields[field])
                if correction is not None:
                    fields[field] = correction[0]

    print(f"\nAbout to add to {file_path.relative_to(repo_root())}:")
    show(fields)

    if not confirm("Add this source?"):
        print("Nothing added.")
        return False

    append_entry(file_path, fields)
    print(f"Added {fields['id']!r}.")

    export_json.main()
    print(f"Wrote {render_md.render_one(file_path).relative_to(repo_root())}")
    return True


# === Edit these two, then run the script ===================================================

TARGET_FOLDER = "Education_materials\\TP"
description = "QM reccomended book with lots of material in it. Containts a book and sumplementary materials to it."
ENTRY = {
    "title": "Sakurai's Modern Quantum Mechanics",
    "importance": 3,  # int or None, 0 - most important
    "description": description,
    "urls": ["https://github.com/yqchen-sci/Quantum-Mechanics/blob/master/README.md"],  # lst[str]
    "tags": ["TP","book", "knowledge"],  # only allowed str
    "checked": "No",  # "fully checked", "checking", "partially checked", "slightly checked", "first look", "No"
    "files": [],  # lst[str], repo-relative paths to files already in the repo
    "platform": "github",  # str
    "cost": "free",
    "notes": ""  # str
}

# ===========================================================================================


def main() -> None:
    add_entry(ENTRY, repo_root() / TARGET_FOLDER / TOML_FILENAME)


if __name__ == "__main__":
    main()
