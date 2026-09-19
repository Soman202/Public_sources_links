"""Dump what the Python toolkit computes, as JSON, so the TS port can be diffed against it.

This is the oracle for the parity tests. It imports scripts/ read-only and writes nothing
anywhere -- the validator's fix pass, the exporters and the renderers are never called, only
the pure functions that compute findings, scores and generated text.

    uv run python scripts/py-oracle.py findings        three tiers + unreadable files
    uv run python scripts/py-oracle.py search QUERY    ranked ids for one query
    uv run python scripts/py-oracle.py render          the sources.md text per folder
    uv run python scripts/py-oracle.py export          the sources.json document

Run from web/.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

WEB_ROOT = Path(__file__).parents[1]
REPO_ROOT = WEB_ROOT.parent

sys.path.insert(0, str(REPO_ROOT / "scripts"))

from common.lib import load_all_docs, repo_root  # noqa: E402
import export_json  # noqa: E402
import render_md  # noqa: E402
import search as search_module  # noqa: E402
from validate_sources import build_index, validate  # noqa: E402


def rel(path: Path) -> str:
    return path.relative_to(repo_root()).as_posix()


def findings() -> dict:
    docs, unreadable = load_all_docs()
    index = build_index(docs)

    structural, consistency, convention = [], [], []
    for path, doc in docs.items():
        # The SHORT folder name, which is what validate_sources.py passes through.
        folder = path.parent.name
        for entry in doc.get("source", []):
            entry_structural, entry_consistency, entry_convention = validate(entry, folder, index)
            structural.extend(entry_structural)
            consistency.extend(entry_consistency)
            convention.extend(entry_convention)

    return {
        "files": sorted(rel(path) for path in docs),
        "unreadable": sorted(unreadable),
        "structural": structural,
        "consistency": consistency,
        "convention": convention,
    }


def search(terms: list[str]) -> dict:
    entries, file_count, _ = search_module.collect_entries()
    matches = search_module.search(entries, terms)

    return {
        "terms": terms,
        "file_count": file_count,
        "results": [
            {
                "score": score,
                "folder": folder,
                "title": search_module.entry_label(entry),
                "id": (entry.get("id") or "").strip(),
                "tag_hits": list(tag_hits),
                "word_hits": [[term, count] for term, count in word_hits],
            }
            for score, entry, folder, tag_hits, word_hits in matches
        ],
    }


def render() -> dict:
    docs, _ = load_all_docs()
    return {
        rel(path): render_md.render_folder(
            path.parent.relative_to(repo_root()).as_posix(), doc
        )
        for path, doc in docs.items()
    }


def export() -> dict:
    data, _ = export_json.build_json()
    return data


def main() -> None:
    argv = sys.argv[1:]
    if not argv:
        raise SystemExit(__doc__)

    command, rest = argv[0], argv[1:]

    if command == "findings":
        payload = findings()
    elif command == "search":
        payload = search(rest)
    elif command == "render":
        payload = render()
    elif command == "export":
        payload = export()
    else:
        raise SystemExit(f"unknown command {command!r}. Expected findings/search/render/export.")

    # Windows defaults stdout to cp1252, which mangles the non-ASCII in some titles into
    # replacement characters -- and a mangled character is a parity failure that has
    # nothing to do with the port.
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")

    # ensure_ascii=False so the JSON carries the same characters the findings do.
    sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
