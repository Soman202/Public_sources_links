import { useMemo, useState } from "react";

import type { ViewProps } from "../App";
import { EntryCard, FindingsList, text } from "../components";
import { normalizeFields, planDelete, planEdit, validateCandidate } from "../lib/collection";
import type { ParsedEntry, SourceDoc } from "../lib/types";
import { EntryForm, entryFrom, formFrom, type FormState } from "./EntryForm";

interface Target {
  doc: SourceDoc;
  parsed: ParsedEntry;
}

/** Replaces edite_source.py: find by id or title, merge only what changed, bump
 *  date_editing, confirm. Deletion is recoverable only through git, which is said out loud
 *  the way the script does. */
export function EditView({ collection, commit, busy, client }: ViewProps) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [form, setForm] = useState<FormState>(() => formFrom(null));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const found: Target[] = [];
    for (const doc of collection.docs) {
      for (const parsed of doc.entries) {
        const id = text(parsed.entry.id).toLowerCase();
        const title = text(parsed.entry.title).toLowerCase();
        if (id === needle || title.includes(needle)) found.push({ doc, parsed });
      }
    }
    return found.slice(0, 25);
  }, [collection, query]);

  const choose = (next: Target) => {
    setTarget(next);
    setForm(formFrom(next.parsed.entry));
    setConfirmDelete(false);
  };

  const candidate = useMemo(
    () => (target ? normalizeFields(collection, entryFrom(form)) : null),
    [collection, form, target],
  );

  const findings = useMemo(
    () =>
      target && candidate
        ? validateCandidate(collection, target.doc.folder, candidate, target.parsed.key)
        : null,
    [collection, target, candidate],
  );

  const blocking = findings ? findings.structural.length + findings.consistency.length : 0;

  return (
    <>
      <h2>Edit or delete</h2>

      <label htmlFor="find">Find by id, or by any part of the title</label>
      <input
        id="find"
        value={query}
        autoCapitalize="none"
        onChange={(event) => setQuery(event.target.value)}
      />

      {!target &&
        matches.map((match, index) => (
          <EntryCard
            key={index}
            entry={match.parsed.entry}
            folder={match.doc.folder}
            blobUrl={(path) => client.blobUrl(path)}
            actions={<button onClick={() => choose(match)}>Edit this</button>}
          />
        ))}

      {!target && query.trim() && matches.length === 0 && (
        <p className="muted">Nothing matches “{query}”.</p>
      )}

      {target && candidate && findings && (
        <>
          <div className="banner warn">
            Editing <strong>{text(target.parsed.entry.title)}</strong> in {target.doc.folder} ·{" "}
            <code>{text(target.parsed.entry.id)}</code>
            <br />
            <button style={{ marginTop: 8 }} onClick={() => setTarget(null)}>
              Pick a different entry
            </button>
          </div>

          <EntryForm
            form={form}
            onChange={setForm}
            allowedTags={collection.allowedTags}
            tagTypes={collection.tagTypes}
          />

          <h3>Preview</h3>
          <p className="small muted">
            Only the entry’s own lines are rewritten — everything else in the file is left
            byte for byte as it is. date_editing is bumped to today on save.
          </p>
          <FindingsList findings={findings} emptyText="No problems — ready to save." />

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="primary"
              disabled={busy || blocking > 0}
              onClick={() => void commit(planEdit(collection, target, candidate)).then(() => setTarget(null))}
            >
              {busy ? "Committing…" : "Save changes"}
            </button>

            {!confirmDelete ? (
              <button className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            ) : (
              <button
                className="danger"
                disabled={busy}
                onClick={() => void commit(planDelete(collection, target)).then(() => setTarget(null))}
              >
                Really delete — only git can undo this
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
