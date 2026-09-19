import { useMemo, useState } from "react";

import type { SourceEntry } from "./lib/types";
import { asList } from "./lib/validate";
import type { Findings } from "./lib/types";

export function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export function stringList(value: unknown): string[] {
  return asList(value).filter((item): item is string => typeof item === "string");
}

/** Tag picker over the vocabulary, grouped by the [tags_type] fields.
 *
 *  Selection ORDER is shown and preserved: tags[0] is the primary tag and feeds the
 *  entry's id, so the list is never sorted and the first pick is labelled as primary.
 */
export function TagPicker({
  allowedTags,
  tagTypes,
  selected,
  onChange,
}: {
  allowedTags: string[];
  tagTypes: Record<string, string[]>;
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const [group, setGroup] = useState<string>("all");

  const visible = useMemo(() => {
    if (group === "all") return allowedTags;
    return (tagTypes[group] ?? []).filter((tag) => allowedTags.includes(tag));
  }, [group, allowedTags, tagTypes]);

  const toggle = (tag: string) => {
    onChange(selected.includes(tag) ? selected.filter((item) => item !== tag) : [...selected, tag]);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <select value={group} onChange={(event) => setGroup(event.target.value)} className="grow">
          <option value="all">all tags ({allowedTags.length})</option>
          {Object.entries(tagTypes).map(([field, members]) => (
            <option key={field} value={field}>
              {field} ({members.length})
            </option>
          ))}
        </select>
      </div>

      <div>
        {visible.map((tag) => {
          const position = selected.indexOf(tag);
          return (
            <span
              key={tag}
              className={position === -1 ? "tag" : "tag on"}
              onClick={() => toggle(tag)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") toggle(tag);
              }}
            >
              {tag}
              {position !== -1 && <span className="order"> {position + 1}</span>}
            </span>
          );
        })}
      </div>

      {selected.length > 0 && (
        <p className="small muted" style={{ marginTop: 8 }}>
          Primary tag: <strong>{selected[0]}</strong> — it feeds the entry id. Deselect and
          reselect to reorder.
        </p>
      )}
    </div>
  );
}

export function FindingsList({ findings, emptyText }: { findings: Findings; emptyText: string }) {
  const total =
    findings.structural.length + findings.consistency.length + findings.convention.length;

  if (total === 0) return <p className="muted small">{emptyText}</p>;

  return (
    <>
      {(
        [
          ["Structural anomalies", findings.structural, "error"],
          ["Consistency gaps", findings.consistency, "error"],
          ["Convention / small fixes", findings.convention, "warn"],
        ] as const
      ).map(([heading, items, tone]) =>
        items.length === 0 ? null : (
          <div className="card" key={heading}>
            <strong className={tone === "error" ? "" : "muted"}>
              {heading} ({items.length})
            </strong>
            {items.map((finding) => (
              <div className="finding" key={finding}>
                {finding}
              </div>
            ))}
          </div>
        ),
      )}
    </>
  );
}

export function EntryCard({
  entry,
  folder,
  blobUrl,
  actions,
}: {
  entry: SourceEntry;
  folder: string;
  blobUrl?: (path: string) => string;
  actions?: React.ReactNode;
}) {
  const urls = stringList(entry.urls);
  const files = stringList(entry.files);
  const tags = stringList(entry.tags);

  return (
    <div className="card">
      <div className="row">
        <strong className="grow">{text(entry.title) || "(untitled)"}</strong>
        <span className="score">{text(entry.importance)}</span>
      </div>

      <p className="small muted" style={{ margin: "4px 0" }}>
        {folder} · {text(entry.checked) || "(blank)"}
        {text(entry.platform) && ` · ${text(entry.platform)}`}
        {text(entry.cost) && ` · ${text(entry.cost)}`}
      </p>

      {text(entry.description) && <p className="small">{text(entry.description)}</p>}

      {urls.map((url) => (
        <div className="small" key={url}>
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </div>
      ))}

      {files.map((file) => (
        <div className="small" key={file}>
          {blobUrl ? (
            <a href={blobUrl(file)} target="_blank" rel="noreferrer">
              {file}
            </a>
          ) : (
            file
          )}
        </div>
      ))}

      {tags.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {tags.map((tag) => (
            <span className="tag" key={tag} style={{ cursor: "default" }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {text(entry.notes) && <p className="small muted">Notes: {text(entry.notes)}</p>}

      {actions && (
        <div className="row" style={{ marginTop: 10 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
