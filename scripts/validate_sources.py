"""Audit every sources.toml in the repo and report everything before fixing anything.

Findings are grouped by tier -- structural / consistency / convention -- and printed in full
first. Only then are you offered the narrow, mechanical fixes, behind a single y/N gate.
Nothing is ever rewritten without an explicit "y".

HOW TO USE
    Just run it. Every entry is checked against the schema in scripts/common/lib.py --
    any field that isn't in FIELD_ORDER is reported as an unknown field, so drift shows up
    on its own rather than needing a special mode.

Run: python scripts/validate_sources.py
"""

from __future__ import annotations

from collections import defaultdict

import export_json
import render_md
from common.lib import (
    CHECKED_VALUES,
    DEFAULT_CHECKED,
    DEFAULT_IMPORTANCE,
    FIELD_ORDER,
    FIELD_SPEC,
    REQUIRED_FIELDS,
    as_list,
    confirm,
    entry_label,
    entry_to_plain_dict,
    file_missing_problem,
    file_size_problem,
    has_location,
    load_all_docs,
    looks_like_url,
    normalize_url,
    read_tags,
    save_toml,
)

import tomlkit

MAX_LIST_ITEM = 500  # urls and file paths get their own cap, longer than a title

_allowed_tags_cache: list[str] | None = None


def allowed_tags() -> list[str]:
    """read_tags() hits the disk, and validation asks for the list once per entry."""
    global _allowed_tags_cache
    if _allowed_tags_cache is None:
        _allowed_tags_cache = read_tags()
    return _allowed_tags_cache


def reset_allowed_tags_cache() -> None:
    """Drop the memo after add_tag() writes a new tag, or the fresh tag reads as unknown."""
    global _allowed_tags_cache
    _allowed_tags_cache = None


def canonical(value: str, vocabulary: list[str]) -> str | None:
    """Case-insensitive lookup returning the vocabulary's own spelling.

    Both fixed-vocabulary fields are mixed-case ("No" among lowercase checked values, "LLM"
    among lowercase tags), so casing is corrected towards the vocabulary rather than simply
    lowercased -- blind .lower() would break exactly those entries.
    """
    target = value.strip().lower()
    for allowed in vocabulary:
        if allowed.lower() == target:
            return allowed
    return None


# --- Block A: per-field checks -------------------------------------------------------------

def field_validate(field: str, field_value) -> str | None:
    """Check one field's value against FIELD_SPEC: type, length, and fixed vocabularies.

    Returns a problem string, or None when the field is fine. Never raises -- a malformed
    entry is something to report, not something to crash on. Unknown fields are not this
    function's job; validate() reports those.

    id / title / platform / cost / date_editing - str
    description / notes - str, longer cap
    urls / files - list[str]
    tags - list[str], each from allowed_tags.toml
    checked - str from CHECKED_VALUES
    importance - int; lower = higher
    """
    if field not in FIELD_SPEC:
        return None

    expected_type, max_length = FIELD_SPEC[field]

    if not isinstance(field_value, expected_type):
        got = type(field_value).__name__
        return f"{field} should be {expected_type.__name__}, got {got}: {field_value!r}"

    if expected_type is list:
        non_strings = [item for item in field_value if not isinstance(item, str)]
        if non_strings:
            return f"{field} should hold only strings, got {non_strings!r}"
        too_long = [item for item in field_value if len(item) > MAX_LIST_ITEM]
        if too_long:
            return f"{field} has entries over {MAX_LIST_ITEM} chars: {too_long!r}"

    if max_length is not None and isinstance(field_value, str) and len(field_value) > max_length:
        return f"{field} is {len(field_value)} chars, over the {max_length} limit"

    if field == "checked" and field_value.strip() and canonical(field_value, CHECKED_VALUES) is None:
        return f"checked={field_value!r} is not one of {CHECKED_VALUES}"

    if field == "tags":
        unknown = [t for t in field_value if canonical(t, allowed_tags()) is None]
        if unknown:
            return (f"tags not in allowed_tags.toml: {unknown!r} "
                    "(fix the tag, or add it to scripts/common/allowed_tags.toml)")

    return None


def field_normalize(field: str, field_value):
    """Look for the minor, mechanically safe corrections: whitespace and casing.

    Returns (new_value, what_changed) or None when there's nothing to do. Deliberately does
    not guess at typos -- an unrecognised tag is reported by field_validate and left alone.
    """
    if field not in FIELD_SPEC:
        return None

    if field == "importance" and field_value in ("", None):
        return DEFAULT_IMPORTANCE, f"importance was blank, defaulted to {DEFAULT_IMPORTANCE}"

    # Nothing below is safe on a value of the wrong type (.strip() on an int, say), and
    # field_validate already reports the type. One check here covers every field.
    expected_type, _ = FIELD_SPEC[field]
    if not isinstance(field_value, expected_type):
        return None

    if field == "checked":
        if not field_value.strip():
            return DEFAULT_CHECKED, f"checked was blank, defaulted to {DEFAULT_CHECKED!r}"
        fixed = canonical(field_value, CHECKED_VALUES)
        if fixed is not None and fixed != field_value:
            return fixed, f"checked {field_value!r} recased to {fixed!r}"
        return None

    if field == "tags":
        # Order is meaningful and stays exactly as typed -- tags[0] is the primary tag
        # (make_id builds an entry's id fragment from it), so never sort them.
        cleaned = []
        for tag in field_value:
            tag = tag.strip()
            if not tag:
                continue
            tag = canonical(tag, allowed_tags()) or tag
            if tag not in cleaned:
                cleaned.append(tag)
        if cleaned != list(field_value):
            return cleaned, "tags stripped, recased and deduped"
        return None

    if isinstance(field_value, str):
        stripped = field_value.strip()
        if stripped != field_value:
            return stripped, f"{field} had surrounding whitespace"
        return None

    if isinstance(field_value, list):
        cleaned = [item.strip() for item in field_value if isinstance(item, str) and item.strip()]
        if cleaned != list(field_value):
            return cleaned, f"{field} had blank or padded entries"

    return None


# --- Block B: per-entry checks -------------------------------------------------------------

def entry_similar(entry, folder: str, index: dict) -> list[str]:
    """Report this entry's collisions with earlier entries: same id, url, title or file.

    URLs compare through normalize_url, so trailing slashes and www. don't hide a repeat.
    Only the later entry of a colliding pair reports, so each pair is named exactly once.
    """
    findings = []
    label = entry_label(entry)

    for kind, keys in (
        ("id", [(entry.get("id") or "").strip()]),
        ("title", [label.lower()]),
        ("url", [normalize_url(u) for u in as_list(entry.get("urls"))]),
        ("file", [f.strip() for f in as_list(entry.get("files"))]),
    ):
        for key in keys:
            if not key:
                continue
            occurrences = index[kind][key]
            first_folder, first_label, first_id = occurrences[0]
            if id(entry) == first_id:
                continue  # this entry is the original, not the repeat
            findings.append(
                f"[{folder}] '{label}': duplicate {kind} ({key}) -- "
                f"already used by {first_folder}:'{first_label}'"
            )

    return findings


def validate(entry, folder: str, index: dict) -> tuple[list[str], list[str], list[str]]:
    """Check one entry against the schema, sorting findings into the three tiers."""
    structural, consistency, convention = [], [], []
    label = entry_label(entry)
    where = f"[{folder}] '{label}'"

    for field in REQUIRED_FIELDS:
        value = entry.get(field)
        if value:
            continue
        # A blank field a normalizer can fill is a convention fix, not a structural hole.
        if field in entry and field_normalize(field, value) is not None:
            convention.append(f"{where}: {field} is blank (fixable)")
        else:
            structural.append(f"{where}: missing required field {field!r}")

    # importance is optional, but an entry without one is unranked -- default rather than nag.
    if "importance" not in entry:
        convention.append(f"{where}: no importance set, defaults to {DEFAULT_IMPORTANCE} (fixable)")

    for field, value in entry.items():
        if field not in FIELD_SPEC:
            structural.append(f"{where}: unknown field {field!r} (not in FIELD_ORDER)")
            continue

        problem = field_validate(field, value)
        if problem:
            structural.append(f"{where}: {problem}")

        correction = field_normalize(field, value)
        if correction is not None and value:
            convention.append(f"{where}: {correction[1]} (fixable)")

    for url in as_list(entry.get("urls")):
        if url and not looks_like_url(url):
            structural.append(f"{where}: url does not look like an http(s) link: {url!r}")

    for file_field in as_list(entry.get("files")):
        missing = file_missing_problem(file_field)
        if missing:
            structural.append(f"{where}: {missing}")
        oversized = file_size_problem(file_field)
        if oversized:
            convention.append(f"{where}: {oversized}")

    if not has_location(entry):
        structural.append(f"{where}: has neither a url nor a file -- no way to locate this source")

    consistency.extend(entry_similar(entry, folder, index))

    return structural, consistency, convention


# --- Block C: rebuilding an entry's table -------------------------------------------------

def order_fields(fields: dict) -> dict:
    """Reorder a field dict to FIELD_ORDER, keeping anything unrecognised at the end."""
    ordered = {field: fields[field] for field in FIELD_ORDER if field in fields}
    ordered.update({k: v for k, v in fields.items() if k not in ordered})
    return ordered


def build_table(fields: dict):
    """Turn a plain field dict into a tomlkit table, keeping FIELD_ORDER's key order."""
    table = tomlkit.table()
    for key, value in fields.items():
        if isinstance(value, list):
            array = tomlkit.array()
            for item in value:
                array.append(item)
            table.add(key, array)
        else:
            table.add(key, value if value is not None else "")
    return table


# --- Block D: fixes, repo walk, entry point -----------------------------------------------

def apply_small_fixes(docs: dict) -> int:
    """Apply every field_normalize correction, plus a default importance where none is set."""
    fixed = 0
    for path, doc in docs.items():
        entries = doc.get("source")
        if not entries:
            continue
        changed = False
        for position, entry in enumerate(list(entries)):
            for field in list(entry.keys()):
                correction = field_normalize(field, entry[field])
                if correction is None:
                    continue
                entry[field] = correction[0]
                fixed += 1
                changed = True

            # An absent key is never visited by the loop above, so add it here. The table is
            # rebuilt so importance lands in its FIELD_ORDER slot, not tacked on at the end.
            if "importance" not in entry:
                fields = entry_to_plain_dict(entry)
                fields["importance"] = DEFAULT_IMPORTANCE
                entries[position] = build_table(order_fields(fields))
                fixed += 1
                changed = True
        if changed:
            save_toml(path, doc)
    return fixed


def build_index(docs: dict) -> dict:
    """Map id / title / url / file -> every entry using it, in file order."""
    index = {kind: defaultdict(list) for kind in ("id", "title", "url", "file")}
    for path, doc in docs.items():
        folder = path.parent.name
        for entry in doc.get("source", []):
            label = entry_label(entry)
            stamp = (folder, label, id(entry))
            entry_id = (entry.get("id") or "").strip()
            if entry_id:
                index["id"][entry_id].append(stamp)
            index["title"][label.lower()].append(stamp)
            for url in as_list(entry.get("urls")):
                index["url"][normalize_url(url)].append(stamp)
            for file_field in as_list(entry.get("files")):
                index["file"][file_field.strip()].append(stamp)
    return index


def regenerate() -> None:
    """Refresh the derived views after a fix pass wrote to disk.

    Derived files are regenerated, never hand-patched, so every mutating path ends here.
    """
    export_json.main()
    written, _ = render_md.render_all()
    print(f"Wrote {len(written)} {render_md.MD_FILENAME} file(s).")


def validate_repo() -> None:
    """Audit every sources.toml in the repo, report in full, then offer the small fixes."""
    docs, unreadable = load_all_docs()
    index = build_index(docs)

    structural, consistency, convention = [], [], []

    for path, doc in docs.items():
        folder = path.parent.name
        for entry in doc.get("source", []):
            entry_structural, entry_consistency, entry_convention = validate(entry, folder, index)
            structural.extend(entry_structural)
            consistency.extend(entry_consistency)
            convention.extend(entry_convention)

    total = len(unreadable) + len(structural) + len(consistency) + len(convention)
    if total == 0:
        print(f"No issues found across {len(docs)} sources.toml file(s).")
        return

    print(f"Found {total} issue(s) across {len(docs) + len(unreadable)} sources.toml file(s):\n")

    # First, and separately: a file that wouldn't parse had none of its entries checked.
    if unreadable:
        print(f"== UNREADABLE FILES ({len(unreadable)}) ==")
        for failure in unreadable:
            print(f"  - {failure}")
        print("  (skipped entirely -- no entries in these files were checked)\n")

    for heading, findings in (
        ("STRUCTURAL ANOMALIES", structural),
        ("CONSISTENCY GAPS", consistency),
        ("CONVENTION / SMALL-FIX CANDIDATES", convention),
    ):
        if findings:
            print(f"== {heading} ({len(findings)}) ==")
            for finding in findings:
                print(f"  - {finding}")
            print()

    fixable = sum(1 for finding in convention if "(fixable)" in finding)

    if fixable:
        if confirm(f"{fixable} small, mechanical fix(es) available (whitespace, casing, "
                   f"tag dedupe, blank 'checked', missing importance -> {DEFAULT_IMPORTANCE}). "
                   "Apply them now?"):
            fixed = apply_small_fixes(docs)
            print(f"Applied {fixed} small fix(es).")
            if fixed:
                regenerate()
        else:
            print("No small fixes applied.")
    else:
        print("Nothing here is auto-fixable by the everyday pass.")


def main() -> None:
    validate_repo()


if __name__ == "__main__":
    main()
