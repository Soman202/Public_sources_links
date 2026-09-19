"""Change fields on one existing source, or delete it, without touching the rest of the file.

The entry is found by id or title anywhere in the repo, shown to you, re-validated with
your changes merged in, and only then written back -- keeping its position in the file and
leaving every other entry and comment untouched.

HOW TO USE
    Edit the constants near the bottom -- FINDING_KEY (the id, or the exact title) and
    NEW_ENTRY (only the fields you want changed) -- then run it. Anything you leave out of
    NEW_ENTRY keeps its current value; date_editing is bumped for you.

    To remove a source instead, set DELETE = True: the whole entry is printed first and
    nothing goes until you confirm. NEW_ENTRY is ignored in that mode.

    Duplicate checking is deliberately skipped here, since an edited entry always collides
    with its own former url and title. Run the repo-wide audit afterwards if an edit
    introduced a url that already exists elsewhere.

Run: python scripts/edite_source.py
"""

from __future__ import annotations

from pathlib import Path

import export_json
import render_md
from common.lib import (
    confirm,
    entry_label,
    entry_to_plain_dict,
    load_all_docs,
    make_id,
    repo_root,
    save_toml,
    today_iso,
)
from validate_sources import (
    build_index,
    build_table,
    field_normalize,
    order_fields,
    validate,
)


def find_matches(docs: dict, finding_key: str) -> list[tuple[Path, object, int]]:
    """Locate an entry by id, falling back to title. Returns (path, doc, position) per hit.

    id is tried alone first: an exact id is unambiguous by design, so a title that happens
    to collide with someone's id shouldn't turn a clean lookup into an ambiguous one.
    """
    key = finding_key.strip()

    by_id, by_title = [], []
    for path, doc in docs.items():
        for position, entry in enumerate(doc.get("source", [])):
            if (entry.get("id") or "").strip() == key:
                by_id.append((path, doc, position))
            if entry_label(entry).lower() == key.lower():
                by_title.append((path, doc, position))

    return by_id or by_title


def describe(path: Path, entry) -> str:
    folder = path.parent.relative_to(repo_root()).as_posix()
    return f"[{folder}] {entry_label(entry)!r} (id={(entry.get('id') or '').strip()!r})"


def show(fields: dict) -> None:
    for key, value in order_fields(fields).items():
        print(f"  {key:<13} {value!r}")


def resolve(finding_key: str) -> tuple[Path, object, int] | None:
    """The one source matching finding_key, or None having said why it couldn't pick one."""
    docs, unreadable = load_all_docs()
    for failure in unreadable:
        print(f"  skipped (unreadable): {failure}")

    matches = find_matches(docs, finding_key)

    if not matches:
        print(f"No source matches {finding_key!r} by id or title.")
        return None

    if len(matches) > 1:
        print(f"{len(matches)} sources match {finding_key!r} -- use an id to pick one:")
        for path, doc, position in matches:
            print(f"  - {describe(path, doc['source'][position])}")
        return None

    return matches[0]


def merge(entry, new_entry: dict) -> dict:
    """The existing entry as a plain dict with new_entry laid over it."""
    fields = entry_to_plain_dict(entry)
    fields.update(new_entry)
    fields["date_editing"] = today_iso()
    return fields


def show_diff(before: dict, after: dict) -> None:
    for key in order_fields(after):
        if before.get(key) != after.get(key):
            print(f"  {key:<13} {before.get(key)!r}  ->  {after[key]!r}")


def edit(finding_key: str, new_entry) -> bool:
    """Merge new_entry into the source matching finding_key, then write it back if confirmed."""
    match = resolve(finding_key)
    if match is None:
        return False

    path, doc, position = match
    entries = doc["source"]
    before = entry_to_plain_dict(entries[position])

    print(f"Found {describe(path, entries[position])}")
    if not confirm("Edit this entry?"):
        print("Nothing changed.")
        return False

    fields = merge(entries[position], new_entry)
    if not (fields.get("id") or "").strip():
        fields["id"] = make_id(
            fields["title"] if isinstance(fields.get("title"), str) else "",
            [tag for tag in fields.get("tags") or [] if isinstance(tag, str)],
            fields["importance"] if isinstance(fields.get("importance"), int) else 9,
            bool(fields.get("files")),
            set(),
        )

    folder = path.parent.name

    # An index holding only the candidate: every key resolves to the entry itself, so
    # entry_similar skips all of them as "the original" and returns nothing. Every other
    # check -- required fields, types, tag vocabulary, url shape, file exists -- still runs.
    index = build_index({path: {"source": [fields]}})
    structural, _, convention = validate(fields, folder, index)

    if structural:
        print(f"\nCannot apply this edit -- {len(structural)} problem(s):")
        for finding in structural:
            print(f"  - {finding}")
        return False

    if convention:
        print(f"\n{len(convention)} small issue(s):")
        for finding in convention:
            print(f"  - {finding}")

        if any("(fixable)" in finding for finding in convention):
            if not confirm("Apply these corrections and continue?"):
                print("Nothing changed. Correct the edit and re-run.")
                return False
            for field in list(fields):
                correction = field_normalize(field, fields[field])
                if correction is not None:
                    fields[field] = correction[0]

    if fields == before:
        print("\nNothing to change -- the entry already matches.")
        return False

    print(f"\nAbout to change in {path.relative_to(repo_root())}:")
    show_diff(before, fields)

    if not confirm("Write this change?"):
        print("Nothing changed.")
        return False

    entries[position] = build_table(order_fields(fields))
    save_toml(path, doc)
    print(f"Updated {fields['id']!r}.")

    export_json.main()
    print(f"Wrote {render_md.render_one(path).relative_to(repo_root())}")
    return True


def delete_entry(finding_key: str) -> bool:
    """Remove the source matching finding_key from its TOML, if confirmed."""
    match = resolve(finding_key)
    if match is None:
        return False

    path, doc, position = match
    entries = doc["source"]
    removed = describe(path, entries[position])

    print(f"Found {removed}")
    print(f"\nAbout to delete from {path.relative_to(repo_root())}:")
    show(entry_to_plain_dict(entries[position]))

    if not confirm("Delete this source? It is only recoverable through git."):
        print("Nothing deleted.")
        return False

    del entries[position]
    save_toml(path, doc)
    print(f"Deleted {removed}")

    export_json.main()
    print(f"Wrote {render_md.render_one(path).relative_to(repo_root())}")
    return True


# === Edit these two, then run the script ===================================================

FINDING_KEY = "LightCast"  # an entry's id, or its exact title
DELETE = False  # True removes that entry instead of editing it; NEW_ENTRY is then ignored
TARGET_FOLDER = "Job_applications\\Tools"

NEW_ENTRY = {
    # Only the fields you want changed, e.g.:
    # "checked": "first look",
    # "tags": ["CS_web", "tool"],
    # "notes": "trial ran out",
    "tags": ['API', 'CV', 'curriculum', 'skill_net']
}

# ===========================================================================================


def main() -> None:
    if DELETE:
        delete_entry(FINDING_KEY)
    else:
        edit(FINDING_KEY, NEW_ENTRY)


if __name__ == "__main__":
    main()
