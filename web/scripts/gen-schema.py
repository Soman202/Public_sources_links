"""Generate the TypeScript schema from the Python toolkit. Reads scripts/, writes web/.

The web app needs the same field table the Python validator uses. Transcribing it by hand
would create a second source of truth that silently drifts the first time FIELD_SPEC
changes. So it is derived instead: this script imports scripts/common/lib.py and
scripts/validate_sources.py read-only and emits src/schema/schema.generated.ts.

Nothing under scripts/ is ever written to. If that import stops working, the build fails
loudly rather than falling back to a stale copy -- which is the whole point.

Run: uv run python scripts/gen-schema.py          (from web/)
     uv run python scripts/gen-schema.py --check  (exit 1 if the output is out of date)
"""

from __future__ import annotations

import sys
from pathlib import Path

WEB_ROOT = Path(__file__).parents[1]
REPO_ROOT = WEB_ROOT.parent
OUTPUT = WEB_ROOT / "src" / "schema" / "schema.generated.ts"

# The toolkit uses flat imports (`import export_json`, `from common.lib import ...`), which
# only resolve when scripts/ itself is on sys.path -- the same reason its modules are run as
# `python scripts/add_source.py` rather than `python -m scripts.add_source`.
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from common import lib  # noqa: E402
import validate_sources  # noqa: E402

# Python type -> the tag validate.ts switches on.
TYPE_NAMES = {str: "string", int: "integer", list: "array"}


def ts_string(value: str) -> str:
    """A TS string literal. json.dumps would do, but escaping here keeps output predictable."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def ts_string_array(values) -> str:
    return "[" + ", ".join(ts_string(v) for v in values) + "]"


def field_spec_entries() -> list[str]:
    """One line per field: name -> {type, maxLength}. Key order follows FIELD_SPEC."""
    lines = []
    for field, (expected_type, max_length) in lib.FIELD_SPEC.items():
        type_name = TYPE_NAMES.get(expected_type)
        if type_name is None:
            raise SystemExit(
                f"FIELD_SPEC[{field!r}] has type {expected_type!r}, which gen-schema.py "
                "does not know how to express in TypeScript. Extend TYPE_NAMES."
            )
        length = "null" if max_length is None else str(max_length)
        lines.append(
            f"  {ts_string(field)}: {{ type: {ts_string(type_name)}, maxLength: {length} }},"
        )
    return lines


def render() -> str:
    body = [
        "// GENERATED FILE -- do not edit.",
        "// Source of truth: scripts/common/lib.py and scripts/validate_sources.py.",
        "// Regenerate with `npm run schema`. Verify with `uv run python scripts/gen-schema.py --check`.",
        "",
        "export type FieldType = \"string\" | \"integer\" | \"array\";",
        "",
        "export interface FieldRule {",
        "  type: FieldType;",
        "  maxLength: number | null;",
        "}",
        "",
        f"export const FIELD_ORDER = {ts_string_array(lib.FIELD_ORDER)} as const;",
        "",
        f"export const REQUIRED_FIELDS = {ts_string_array(lib.REQUIRED_FIELDS)} as const;",
        "",
        f"export const CHECKED_VALUES = {ts_string_array(lib.CHECKED_VALUES)} as const;",
        "",
        "export const FIELD_SPEC: Record<string, FieldRule> = {",
        *field_spec_entries(),
        "};",
        "",
        f"export const DEFAULT_IMPORTANCE = {lib.DEFAULT_IMPORTANCE};",
        f"export const DEFAULT_CHECKED = {ts_string(lib.DEFAULT_CHECKED)};",
        f"export const MAX_FIELD_VALUE = {lib.MAX_FIELD_VALUE};",
        f"export const MAX_DESCRIPTION_VALUE = {lib.MAX_DESCRIPTION_VALUE};",
        f"export const MAX_LIST_ITEM = {validate_sources.MAX_LIST_ITEM};",
        f"export const FILE_SIZE_WARN_BYTES = {lib.FILE_SIZE_WARN_BYTES};",
        "",
        f"export const TOML_FILENAME = {ts_string(lib.TOML_FILENAME)};",
        f"export const TAGS_FILENAME = {ts_string(lib.TAGS_FILEAME)};",
        "",
        "export type SourceField = (typeof FIELD_ORDER)[number];",
        "",
    ]
    return "\n".join(body)


def main() -> None:
    generated = render()
    check_only = "--check" in sys.argv[1:]

    current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.is_file() else None

    if check_only:
        if current == generated:
            print(f"schema is up to date: {OUTPUT.relative_to(REPO_ROOT).as_posix()}")
            return
        where = "missing" if current is None else "out of date"
        raise SystemExit(
            f"{OUTPUT.relative_to(REPO_ROOT).as_posix()} is {where}. "
            "scripts/common/lib.py changed -- run `npm run schema` and commit the result."
        )

    if current == generated:
        print(f"schema unchanged: {OUTPUT.relative_to(REPO_ROOT).as_posix()}")
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generated, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT).as_posix()}")


if __name__ == "__main__":
    main()
