import { useMemo, useState } from "react";

import type { ViewProps } from "../App";
import { EntryCard } from "../components";
import { allEntries } from "../lib/collection";
import {
  collectionStats,
  search,
  splitTerms,
  IMPORTANCE_BASE,
  TAG_WEIGHT,
} from "../lib/search";
import { importanceOf } from "../lib/render-md";

/** Replaces search.py. Blank query shows the collection statistics, as the script does. */
export function SearchView({ collection, client }: ViewProps) {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => allEntries(collection), [collection]);
  const terms = splitTerms(query);
  const matches = useMemo(
    () => (terms.length > 0 ? search(entries, terms) : []),
    // terms is derived from query; depending on it directly would rebuild every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, query],
  );

  const stats = useMemo(
    () => collectionStats(entries, collection.allowedTags, collection.tagTypes),
    [entries, collection],
  );

  return (
    <>
      <h2>Search</h2>
      <input
        value={query}
        placeholder="Search terms (blank for statistics)"
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
      />

      {terms.length === 0 ? (
        <Stats stats={stats} />
      ) : matches.length === 0 ? (
        <p className="muted">No matches for “{query}”.</p>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 10 }}>
            {matches.length} result{matches.length === 1 ? "" : "s"} · score = {TAG_WEIGHT}×tag
            hits + ({IMPORTANCE_BASE} − importance) + word occurrences
          </p>

          {matches.map((match, index) => (
            <div key={index}>
              <p className="small muted" style={{ margin: "10px 0 -6px" }}>
                <span className="score">{match.score}</span>{" "}
                {match.tagHits.length > 0 && `tags: ${match.tagHits.join(", ")} +${TAG_WEIGHT * match.tagHits.length} · `}
                {match.wordHits.length > 0 &&
                  `words: ${match.wordHits.map(([term, count]) => `${term} ×${count}`).join(", ")} +${match.wordHits.reduce((sum, [, count]) => sum + count, 0)} · `}
                importance {importanceOf(match.entry)} +{IMPORTANCE_BASE - importanceOf(match.entry)}
              </p>
              <EntryCard
                entry={match.entry}
                folder={match.folder}
                blobUrl={(path) => client.blobUrl(path)}
              />
            </div>
          ))}
        </>
      )}
    </>
  );
}

function Stats({ stats }: { stats: ReturnType<typeof collectionStats> }) {
  return (
    <>
      <div className="card">
        <strong>{stats.total} entries</strong>
        <p className="small muted">Lower importance = more important.</p>
        <div className="row">
          {stats.byImportance.map(([value, count]) => (
            <span className="tag" key={value} style={{ cursor: "default" }}>
              {value}: {count}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <strong>By tag ({stats.byTag.length} in use)</strong>
        <div style={{ marginTop: 6 }}>
          {stats.byTag.map(([tag, count]) => (
            <span className="tag" key={tag} style={{ cursor: "default" }}>
              {tag} {count}
            </span>
          ))}
        </div>
        {stats.unusedTags.length > 0 && (
          <p className="small muted">
            {stats.unusedTags.length} unused: {stats.unusedTags.join(", ")}
          </p>
        )}
        {stats.unknownTags.length > 0 && (
          <p className="small" style={{ color: "var(--warn)" }}>
            not in allowed_tags.toml: {stats.unknownTags.join(", ")}
          </p>
        )}
      </div>

      <div className="card">
        <strong>By progress</strong>
        <div style={{ marginTop: 6 }}>
          {stats.byChecked.map(([stage, count]) => (
            <span className="tag" key={stage} style={{ cursor: "default" }}>
              {stage} {count}
            </span>
          ))}
          {stats.offVocabularyChecked.map(([stage, count]) => (
            <span className="tag" key={stage} style={{ cursor: "default", color: "var(--warn)" }}>
              {stage || "(blank)"} {count}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <strong>By cost</strong>
        <p className="small">
          free {stats.cost.free} · unspecified {stats.cost.unspecified} · other{" "}
          {stats.cost.other}
        </p>
        {stats.otherCosts.map((raw) => (
          <div className="small muted" key={raw}>
            {raw}
          </div>
        ))}
      </div>
    </>
  );
}
