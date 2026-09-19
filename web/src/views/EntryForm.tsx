import { useState } from "react";

import { TagPicker, stringList, text } from "../components";
import { CHECKED_VALUES, DEFAULT_IMPORTANCE } from "../schema/schema.generated";
import type { SourceEntry } from "../lib/types";

export interface FormState {
  title: string;
  importance: number;
  description: string;
  urls: string;
  tags: string[];
  checked: string;
  files: string;
  platform: string;
  cost: string;
  notes: string;
}

export function formFrom(entry: SourceEntry | null): FormState {
  return {
    title: text(entry?.title),
    importance:
      typeof entry?.importance === "number" && Number.isInteger(entry.importance)
        ? entry.importance
        : DEFAULT_IMPORTANCE,
    description: text(entry?.description),
    urls: stringList(entry?.urls).join("\n"),
    tags: stringList(entry?.tags),
    checked: text(entry?.checked) || "No",
    files: stringList(entry?.files).join("\n"),
    platform: text(entry?.platform),
    cost: text(entry?.cost),
    notes: text(entry?.notes),
  };
}

/** Form state to the field dict the toolkit writes. Multi-line boxes become lists. */
export function entryFrom(form: FormState): SourceEntry {
  const lines = (value: string) =>
    value
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item !== "");

  return {
    title: form.title.trim(),
    importance: form.importance,
    description: form.description.trim(),
    urls: lines(form.urls),
    tags: form.tags,
    checked: form.checked,
    files: lines(form.files),
    platform: form.platform.trim(),
    cost: form.cost.trim(),
    notes: form.notes.trim(),
  };
}

export function EntryForm({
  form,
  onChange,
  allowedTags,
  tagTypes,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  allowedTags: string[];
  tagTypes: Record<string, string[]>;
}) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });

  const [showOptional, setShowOptional] = useState(false);

  return (
    <>
      <label htmlFor="title">Title</label>
      <input id="title" value={form.title} onChange={(event) => set("title", event.target.value)} />

      <label htmlFor="importance">
        Importance: {form.importance} — lower is more important (0–9)
      </label>
      <input
        id="importance"
        type="range"
        min={0}
        max={9}
        value={form.importance}
        onChange={(event) => set("importance", Number(event.target.value))}
      />

      <label htmlFor="description">Description</label>
      <textarea
        id="description"
        value={form.description}
        onChange={(event) => set("description", event.target.value)}
      />

      <label htmlFor="urls">URLs — one per line, each starting http:// or https://</label>
      <textarea
        id="urls"
        value={form.urls}
        style={{ minHeight: 60 }}
        autoCapitalize="none"
        onChange={(event) => set("urls", event.target.value)}
      />

      <label>Tags — order matters, the first one feeds the id</label>
      <TagPicker
        allowedTags={allowedTags}
        tagTypes={tagTypes}
        selected={form.tags}
        onChange={(tags) => set("tags", tags)}
      />

      <label htmlFor="checked">Progress</label>
      <select id="checked" value={form.checked} onChange={(event) => set("checked", event.target.value)}>
        {CHECKED_VALUES.map((stage) => (
          <option key={stage} value={stage}>
            {stage}
          </option>
        ))}
      </select>

      <button
        type="button"
        style={{ marginTop: 14 }}
        onClick={() => setShowOptional(!showOptional)}
      >
        {showOptional ? "Hide" : "Show"} files, platform, cost, notes
      </button>

      {showOptional && (
        <>
          <label htmlFor="files">
            Files — repo-relative paths, one per line. The file must already be in the repo.
          </label>
          <textarea
            id="files"
            value={form.files}
            style={{ minHeight: 60 }}
            autoCapitalize="none"
            onChange={(event) => set("files", event.target.value)}
          />

          <label htmlFor="platform">Platform</label>
          <input
            id="platform"
            value={form.platform}
            onChange={(event) => set("platform", event.target.value)}
          />

          <label htmlFor="cost">Cost</label>
          <input id="cost" value={form.cost} onChange={(event) => set("cost", event.target.value)} />

          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </>
      )}
    </>
  );
}
