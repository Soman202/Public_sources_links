// GENERATED FILE -- do not edit.
// Source of truth: scripts/common/lib.py and scripts/validate_sources.py.
// Regenerate with `npm run schema`. Verify with `uv run python scripts/gen-schema.py --check`.

export type FieldType = "string" | "integer" | "array";

export interface FieldRule {
  type: FieldType;
  maxLength: number | null;
}

export const FIELD_ORDER = ["id", "title", "importance", "description", "urls", "tags", "checked", "files", "platform", "cost", "date_editing", "notes"] as const;

export const REQUIRED_FIELDS = ["title", "description", "tags", "checked", "date_editing"] as const;

export const CHECKED_VALUES = ["fully checked", "checking", "partially checked", "slightly checked", "first look", "No"] as const;

export const FIELD_SPEC: Record<string, FieldRule> = {
  "id": { type: "string", maxLength: 250 },
  "title": { type: "string", maxLength: 250 },
  "importance": { type: "integer", maxLength: null },
  "description": { type: "string", maxLength: 10000 },
  "urls": { type: "array", maxLength: null },
  "tags": { type: "array", maxLength: null },
  "checked": { type: "string", maxLength: 250 },
  "files": { type: "array", maxLength: null },
  "platform": { type: "string", maxLength: 250 },
  "cost": { type: "string", maxLength: 250 },
  "date_editing": { type: "string", maxLength: 250 },
  "notes": { type: "string", maxLength: 10000 },
};

export const DEFAULT_IMPORTANCE = 9;
export const DEFAULT_CHECKED = "No";
export const MAX_FIELD_VALUE = 250;
export const MAX_DESCRIPTION_VALUE = 10000;
export const MAX_LIST_ITEM = 500;
export const FILE_SIZE_WARN_BYTES = 10485760;

export const TOML_FILENAME = "sources.toml";
export const TAGS_FILENAME = "allowed_tags.toml";

export type SourceField = (typeof FIELD_ORDER)[number];
