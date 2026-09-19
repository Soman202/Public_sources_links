import { useMemo, useState } from "react";

import type { ViewProps } from "../App";
import { addTag, TagWriteError } from "../lib/tags-write";
import { readTags } from "../lib/toml-read";

const ALLOWED_TAGS_PATH = "scripts/common/allowed_tags.toml";

/** The vocabulary editor.
 *
 *  A tag has to go in two places — the flat `[[tags]]` list and at least one `[tags_type]`
 *  group — and forgetting the second is silent. This makes both happen in one commit.
 */
export function TagsView({ collection, commit, busy }: ViewProps) {
  const [tag, setTag] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of collection.docs) {
      for (const parsed of doc.entries) {
        for (const item of Array.isArray(parsed.entry.tags) ? parsed.entry.tags : []) {
          if (typeof item === "string") counts.set(item, (counts.get(item) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [collection]);

  const toggleGroup = (field: string) =>
    setGroups(groups.includes(field) ? groups.filter((item) => item !== field) : [...groups, field]);

  const submit = async () => {
    setProblem(null);
    try {
      const text = addTag(collection.allowedTagsToml, tag, groups, collection.allowedTags);

      // Adding a tag changes no entry, so nothing derived needs regenerating.
      await commit({
        files: [{ path: ALLOWED_TAGS_PATH, text }],
        message: `added tag ${tag.trim()}`,
        next: { ...collection, allowedTagsToml: text, allowedTags: readTags(text) },
      });
      setTag("");
      setGroups([]);
    } catch (error) {
      setProblem(error instanceof TagWriteError ? error.message : String(error));
    }
  };

  return (
    <>
      <h2>Tags</h2>
      <p className="muted small">
        {collection.allowedTags.length} tags in the vocabulary. The validator rejects
        anything not on this list.
      </p>

      <div className="card">
        <strong>Add a tag</strong>

        <label htmlFor="new-tag">Tag</label>
        <input
          id="new-tag"
          value={tag}
          autoCapitalize="none"
          onChange={(event) => setTag(event.target.value)}
        />

        <label>Groups — a tag needs at least one, and may belong to several</label>
        <div>
          {Object.keys(collection.tagTypes).map((field) => (
            <span
              key={field}
              className={groups.includes(field) ? "tag on" : "tag"}
              onClick={() => toggleGroup(field)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") toggleGroup(field);
              }}
            >
              {field}
            </span>
          ))}
        </div>

        {problem && <div className="banner error">{problem}</div>}

        <button
          className="primary"
          style={{ marginTop: 12 }}
          disabled={busy || !tag.trim() || groups.length === 0}
          onClick={() => void submit()}
        >
          {busy ? "Committing…" : "Add to the vocabulary"}
        </button>
      </div>

      {Object.entries(collection.tagTypes).map(([field, members]) => (
        <div className="card" key={field}>
          <strong>{field}</strong>
          <div style={{ marginTop: 6 }}>
            {members.map((member) => (
              <span className="tag" key={member} style={{ cursor: "default" }}>
                {member}
                <span className="order"> {usage.get(member) ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      ))}

      <div className="card">
        <strong>Not in any group</strong>
        <div style={{ marginTop: 6 }}>
          {collection.allowedTags
            .filter(
              (item) => !Object.values(collection.tagTypes).some((members) => members.includes(item)),
            )
            .map((item) => (
              <span className="tag" key={item} style={{ cursor: "default" }}>
                {item}
              </span>
            ))}
        </div>
        <p className="small muted">
          These exist in the vocabulary but tag_help will never offer them.
        </p>
      </div>
    </>
  );
}
