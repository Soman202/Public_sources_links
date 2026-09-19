"""Walk every sources.toml in the repo and write one combined sources.json at the repo root.

sources.json is a derived artifact -- never hand-edit it. Any script that changes a TOML
calls main() here afterwards, so the JSON view can't go stale.

Run: python scripts/export_json.py
"""

from __future__ import annotations

import json

from common.lib import entry_to_plain_dict, load_all_docs, repo_root, today_iso


def build_json() -> tuple[dict, list[str]]:
    """Build the export document, plus whatever files wouldn't parse for main() to report."""
    docs, unreadable = load_all_docs()

    sources = []
    for path, doc in docs.items():
        # The full relative path, not just the folder name, so Tools and Tools/Free tools
        # stay distinguishable once every entry is flattened into one list.
        folder = path.parent.relative_to(repo_root()).as_posix()
        for entry in doc.get("source", []):
            record = entry_to_plain_dict(entry)
            record["folder"] = folder  # stamped last, so it reads as provenance after the entry's own fields
            sources.append(record)

    return {
        "generated_at": today_iso(),
        "count": len(sources),
        "sources": sources,
    }, unreadable


def main() -> None:
    output_path = repo_root() / "sources.json"
    data, unreadable = build_json()

    # ensure_ascii=False keeps non-ASCII readable rather than \uXXXX-escaped; the explicit
    # utf-8 matters on Windows, where the default encoding is cp1252.
    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {data['count']} sources to {output_path.relative_to(repo_root())}")
    for failure in unreadable:
        print(f"  skipped (unreadable): {failure}")


if __name__ == "__main__":
    main()
