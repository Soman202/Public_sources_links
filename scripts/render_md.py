"""Render a human-readable sources.md next to every sources.toml.

sources.md is a generated view for browsing -- always edit sources.toml, never sources.md
directly (your edits are overwritten on the next render). Called automatically by
validate_sources.py after a fix pass, and safe to re-run at any time.

Run: python scripts/render_md.py
"""

from __future__ import annotations

from pathlib import Path

from common.lib import (
    DEFAULT_IMPORTANCE,
    as_list,
    file_missing_problem,
    load_all_docs,
    load_toml,
    repo_root,
)

MD_FILENAME = "sources.md"


def importance_of(entry) -> int:
    """Sort key: lower = more important.

    A missing or malformed value sorts as DEFAULT_IMPORTANCE -- the same slot
    validate_sources.py would give it once defaulted -- so the browsing order doesn't jump
    around when that fix is finally applied. sorted() is stable, so ties keep TOML order.
    """
    importance = entry.get("importance")
    return importance if isinstance(importance, int) else DEFAULT_IMPORTANCE


def render_entry(entry) -> list[str]:
    """The Markdown block for one source: heading, metadata bullets, prose, separator."""
    title = (entry.get("title") or "").strip() or "(untitled)"
    urls = [u.strip() for u in as_list(entry.get("urls")) if u.strip()]
    files = [f.strip() for f in as_list(entry.get("files")) if f.strip()]
    tags = [t.strip() for t in as_list(entry.get("tags")) if t.strip()]

    lines = [f"## {title}"]

    importance = entry.get("importance")
    if isinstance(importance, int):
        lines.append(f"- **Importance:** {importance}")

    if urls:
        lines.append(f"- **URL:** {urls[0]}")
        if len(urls) > 1:
            lines.append(f"- **Also:** {', '.join(urls[1:])}")
    elif not files:
        lines.append("- **URL:** _(missing)_")

    for file_field in files:
        marker = " _(file not found!)_" if file_missing_problem(file_field) else ""
        lines.append(f"- **File:** {file_field}{marker}")

    for label, field in (("Platform", "platform"), ("Cost", "cost")):
        value = (entry.get(field) or "").strip()
        if value:
            lines.append(f"- **{label}:** {value}")

    checked = (entry.get("checked") or "").strip()
    lines.append(f"- **Checked:** {checked if checked else '_(blank)_'}")

    if tags:
        lines.append(f"- **Tags:** {', '.join(tags)}")

    date_editing = (entry.get("date_editing") or "").strip()
    if date_editing:
        lines.append(f"- **Updated:** {date_editing}")

    lines.append("")

    description = (entry.get("description") or "").strip()
    if description:
        lines.extend([description, ""])

    notes = (entry.get("notes") or "").strip()
    if notes:
        lines.extend([f"_Notes: {notes}_", ""])

    lines.extend(["---", ""])
    return lines


def render_folder(folder_name: str, doc) -> str:
    lines = [
        f"# {folder_name}",
        "",
        "_Generated from `sources.toml` -- edit that file, not this one._",
        "",
    ]

    notes = as_list(doc.get("general_notes"))
    if notes:
        lines.append("## Notes")
        lines.extend(f"- {note}" for note in notes)
        lines.append("")

    entries = list(doc.get("source") or [])
    if not entries:
        lines.append("_No sources yet._")
        return "\n".join(lines) + "\n"

    for entry in sorted(entries, key=importance_of):
        lines.extend(render_entry(entry))

    # The last entry leaves a separator behind that has nothing to separate.
    while lines and lines[-1] in ("", "---"):
        lines.pop()

    return "\n".join(lines) + "\n"


def render_one(path: Path) -> Path:
    """Write just this folder's sources.md, for a script that touched a single TOML.

    Derives the folder name exactly as render_all does, so a one-folder render is
    byte-identical to what a full pass would have written for it.
    """
    doc = load_toml(path)
    folder_name = path.parent.relative_to(repo_root()).as_posix()
    md_path = path.parent / MD_FILENAME
    md_path.write_text(render_folder(folder_name, doc), encoding="utf-8")
    return md_path


def render_all() -> tuple[list[Path], list[str]]:
    """Write every sources.md. Returns (paths written, files that wouldn't parse)."""
    docs, unreadable = load_all_docs()

    written = []
    for path, doc in docs.items():
        folder_name = path.parent.relative_to(repo_root()).as_posix()
        md_path = path.parent / MD_FILENAME
        md_path.write_text(render_folder(folder_name, doc), encoding="utf-8")
        written.append(md_path)

    return written, unreadable


def main() -> None:
    written, unreadable = render_all()
    for path in written:
        print(f"Wrote {path.relative_to(repo_root())}")
    for failure in unreadable:
        print(f"  skipped (unreadable): {failure}")


if __name__ == "__main__":
    main()
