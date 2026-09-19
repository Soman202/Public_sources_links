import { useMemo } from "react";

import type { ViewProps } from "../App";
import { audit, planFixes } from "../lib/collection";

/** Replaces validate_sources.py: the same three tiers, reported in full before anything is
 *  offered as a fix — and the same narrow set of mechanical fixes behind one confirmation. */
export function ValidateView({ collection, commit, busy }: ViewProps) {
  const result = useMemo(() => audit(collection), [collection]);
  const fixes = useMemo(() => planFixes(collection), [collection]);

  const total =
    collection.unreadable.length +
    result.structural.length +
    result.consistency.length +
    result.convention.length;

  return (
    <>
      <h2>Validate</h2>

      {total === 0 ? (
        <div className="banner ok">
          No issues found across {result.fileCount} sources.toml file(s).
        </div>
      ) : (
        <p className="muted small">
          {total} issue(s) across {result.fileCount + collection.unreadable.length} sources.toml
          file(s).
        </p>
      )}

      {collection.unreadable.length > 0 && (
        <div className="banner error">
          <strong>Unreadable files ({collection.unreadable.length})</strong>
          <p className="small">No entries in these files were checked at all.</p>
          {collection.unreadable.map((file) => (
            <div className="finding" key={file.path}>
              {file.path}: {file.message}
            </div>
          ))}
        </div>
      )}

      {(
        [
          ["Structural anomalies", result.structural, "Fix these by hand — the tool never guesses."],
          ["Consistency gaps", result.consistency, "Duplicate id, title, url or file across the repo."],
          ["Convention / small-fix candidates", result.convention, "Those marked (fixable) can be applied below."],
        ] as const
      ).map(([heading, findings, hint]) =>
        findings.length === 0 ? null : (
          <div className="card" key={heading}>
            <strong>
              {heading} ({findings.length})
            </strong>
            <p className="small muted">{hint}</p>
            {findings.map((finding) => (
              <div className="finding" key={finding}>
                {finding}
              </div>
            ))}
          </div>
        ),
      )}

      {result.fixableCount > 0 ? (
        <>
          <p className="small muted">
            {result.fixableCount} mechanical fix(es) available: whitespace, casing towards the
            vocabulary’s own spelling, tag dedupe, blank “checked”, missing importance. An
            unrecognised tag is reported and left exactly as written.
          </p>
          <button
            className="primary"
            disabled={busy || fixes.fixed === 0}
            onClick={() => void commit(fixes)}
          >
            {busy ? "Committing…" : `Apply ${fixes.fixed} fix(es)`}
          </button>
        </>
      ) : (
        total > 0 && (
          <p className="muted small">Nothing here is auto-fixable by the everyday pass.</p>
        )
      )}
    </>
  );
}
