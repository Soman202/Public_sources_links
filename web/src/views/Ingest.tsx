import { useMemo, useState } from "react";

import type { ViewProps } from "../App";
import { planIngest, planIngestReport } from "../lib/collection";

/** Replaces update_files.py: every file under Attachments/ that no sources.toml mentions,
 *  with tags inherited from each tags.toml on its path, outermost first. */
export function IngestView({ collection, commit, busy }: ViewProps) {
  const report = useMemo(() => planIngestReport(collection), [collection]);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(report.candidates.map((candidate) => candidate.path)),
  );

  const toggle = (path: string) => {
    const next = new Set(chosen);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setChosen(next);
  };

  const selected = report.candidates.filter((candidate) => chosen.has(candidate.path));
  const untagged = selected.filter((candidate) => candidate.tags.length === 0);

  return (
    <>
      <h2>Ingest attachments</h2>
      <p className="muted small">
        Already listed: {report.alreadyListed}. New entries are appended to
        Attachments/sources.toml.
      </p>

      {report.invalidTagFiles.length > 0 && (
        <div className="banner error">
          <strong>Invalid tags.toml — every file below these is skipped</strong>
          {report.invalidTagFiles.map((problem) => (
            <div className="finding" key={problem}>
              {problem}
            </div>
          ))}
        </div>
      )}

      {report.emptyTagFiles.length > 0 && (
        <div className="banner warn">
          <strong>Empty tags.toml</strong>
          {report.emptyTagFiles.map((warning) => (
            <div className="finding" key={warning}>
              {warning}
            </div>
          ))}
        </div>
      )}

      {report.skipped.length > 0 && (
        <div className="card">
          <strong>Skipped ({report.skipped.length})</strong>
          {report.skipped.map((line) => (
            <div className="finding" key={line}>
              {line}
            </div>
          ))}
        </div>
      )}

      {report.candidates.length === 0 ? (
        <p className="muted">Nothing new to add.</p>
      ) : (
        <>
          <div className="card">
            <strong>
              New files ({selected.length} of {report.candidates.length} selected)
            </strong>
            {report.candidates.map((candidate) => (
              <label key={candidate.path} className="row" style={{ margin: "8px 0", color: "inherit" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={chosen.has(candidate.path)}
                  onChange={() => toggle(candidate.path)}
                />
                <span className="grow small">
                  {candidate.path}
                  <br />
                  <span className="muted">
                    {candidate.tags.length > 0 ? candidate.tags.join(", ") : "NO TAGS"}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {untagged.length > 0 && (
            <div className="banner warn">
              {untagged.length} of the selected files have no tags. They will be added and
              then flagged by Validate until you tag them — give their folder a tags.toml,
              or fix them from the Edit view.
            </div>
          )}

          <button
            className="primary"
            disabled={busy || selected.length === 0}
            onClick={() => void commit(planIngest(collection, selected))}
          >
            {busy ? "Committing…" : `Add ${selected.length} source(s)`}
          </button>
        </>
      )}
    </>
  );
}
