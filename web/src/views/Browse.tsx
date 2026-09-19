import { useMemo, useState } from "react";

import type { ViewProps } from "../App";
import { EntryCard, stringList } from "../components";
import { CHECKED_VALUES } from "../schema/schema.generated";
import { importanceOf } from "../lib/render-md";

/** Replaces reading sources.md: the folder tree, with the filters a generated file cannot
 *  offer. */
export function BrowseView({ collection, client }: ViewProps) {
  const [folder, setFolder] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [checked, setChecked] = useState<string>("all");

  const entries = useMemo(() => {
    const all = collection.docs.flatMap((doc) =>
      doc.entries.map((parsed) => ({ entry: parsed.entry, folder: doc.folder })),
    );

    return all
      .filter((item) => folder === "all" || item.folder === folder)
      .filter((item) => tag === "all" || stringList(item.entry.tags).includes(tag))
      .filter(
        (item) =>
          checked === "all" ||
          (typeof item.entry.checked === "string" ? item.entry.checked.trim() : "") === checked,
      )
      .sort(
        (a, b) =>
          importanceOf(a.entry) - importanceOf(b.entry) ||
          String(a.entry.title ?? "").localeCompare(String(b.entry.title ?? "")),
      );
  }, [collection, folder, tag, checked]);

  const usedTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of collection.docs) {
      for (const parsed of doc.entries) {
        for (const item of stringList(parsed.entry.tags)) {
          counts.set(item, (counts.get(item) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [collection]);

  return (
    <>
      <h2>Browse</h2>

      <div className="row">
        <select className="grow" value={folder} onChange={(event) => setFolder(event.target.value)}>
          <option value="all">every folder</option>
          {collection.docs
            .map((doc) => doc.folder)
            .sort()
            .map((name) => (
              <option key={name} value={name}>
                {name} ({collection.docs.find((doc) => doc.folder === name)?.entries.length ?? 0})
              </option>
            ))}
        </select>

        <select className="grow" value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="all">every tag</option>
          {usedTags.map(([name, count]) => (
            <option key={name} value={name}>
              {name} ({count})
            </option>
          ))}
        </select>

        <select className="grow" value={checked} onChange={(event) => setChecked(event.target.value)}>
          <option value="all">any progress</option>
          {CHECKED_VALUES.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      </div>

      <p className="muted small" style={{ marginTop: 10 }}>
        {entries.length} of {collection.docs.reduce((total, doc) => total + doc.entries.length, 0)}{" "}
        entries · sorted by importance, lower first
      </p>

      {entries.map((item, index) => (
        <EntryCard
          key={`${item.folder}-${index}`}
          entry={item.entry}
          folder={item.folder}
          blobUrl={(path) => client.blobUrl(path)}
        />
      ))}
    </>
  );
}
