import { useMemo, useState } from "react";

import type { ViewProps } from "../App";
import { FindingsList } from "../components";
import { bytesToBase64 } from "../lib/github";
import { normalizeRepoPath } from "../lib/paths";
import {
  fillDefaults,
  folderPaths,
  normalizeFields,
  planAdd,
  validateCandidate,
} from "../lib/collection";
import { EntryForm, entryFrom, formFrom, type FormState } from "./EntryForm";

/** Replaces add_source.py — and the save_url.toml inbox it was fed from.
 *
 *  The script is configured by editing the ENTRY constant at the bottom of the file and
 *  then running it. This is the same fields as a form, validated against the same rules
 *  before anything is written.
 */
export function AddView({ collection, commit, busy }: ViewProps) {
  const folders = useMemo(() => folderPaths(collection), [collection]);

  const [folder, setFolder] = useState(folders[0] ?? "");
  const [form, setForm] = useState<FormState>(() => formFrom(null));
  const [attachment, setAttachment] = useState<{ name: string; base64: string } | null>(null);
  const [attachmentFolder, setAttachmentFolder] = useState("Attachments");

  const attachmentPath = attachment
    ? normalizeRepoPath(`${attachmentFolder}/${attachment.name}`)
    : null;

  // The entry as it will actually be written: defaults filled, then the same mechanical
  // corrections the validator would offer, so the preview is the truth.
  const candidate = useMemo(() => {
    const base = entryFrom(form);
    if (attachmentPath) base.files = [...(base.files as string[]), attachmentPath];
    return normalizeFields(collection, fillDefaults(base).fields);
  }, [form, collection, attachmentPath]);

  const findings = useMemo(
    () => validateCandidate(collection, folder, candidate),
    [collection, folder, candidate],
  );

  // An attachment being committed in the same commit does not exist in the tree yet, so
  // its "file does not exist on disk" finding is expected rather than blocking.
  const blocking = [...findings.structural, ...findings.consistency].filter(
    (finding) => !(attachmentPath && finding.includes(attachmentPath)),
  );

  const canSubmit = blocking.length === 0 && form.title.trim() !== "" && !busy;

  const pickFile = async (file: File | undefined) => {
    if (!file) return setAttachment(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    setAttachment({ name: file.name, base64: bytesToBase64(bytes) });
  };

  const submit = async () => {
    await commit(
      planAdd(
        collection,
        folder,
        candidate,
        attachment && attachmentPath
          ? { path: attachmentPath, base64: attachment.base64 }
          : undefined,
      ),
    );
    setForm(formFrom(null));
    setAttachment(null);
  };

  return (
    <>
      <h2>Add a source</h2>

      <label htmlFor="folder">Folder</label>
      <select id="folder" value={folder} onChange={(event) => setFolder(event.target.value)}>
        {folders.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <EntryForm
        form={form}
        onChange={setForm}
        allowedTags={collection.allowedTags}
        tagTypes={collection.tagTypes}
      />

      <label htmlFor="attachment">Attach a file (optional) — committed alongside the entry</label>
      <input
        id="attachment"
        type="file"
        onChange={(event) => void pickFile(event.target.files?.[0])}
      />
      {attachment && (
        <>
          <label htmlFor="attachment-folder">Attachment folder</label>
          <input
            id="attachment-folder"
            value={attachmentFolder}
            autoCapitalize="none"
            onChange={(event) => setAttachmentFolder(event.target.value)}
          />
          <p className="small muted">Will be committed as {attachmentPath}</p>
        </>
      )}

      <h3>Preview</h3>
      <p className="small muted">
        The id is generated on submit from the primary tag, the first word of the title, and
        whether there is a file.
      </p>

      <FindingsList findings={findings} emptyText="No problems — ready to add." />

      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Committing…" : "Add source"}
        </button>
        {blocking.length > 0 && (
          <span className="small" style={{ color: "var(--danger)" }}>
            {blocking.length} problem{blocking.length === 1 ? "" : "s"} must be fixed first
          </span>
        )}
      </div>
    </>
  );
}
