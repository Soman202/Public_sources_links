# LinkSource web

A website for the collection in this repo, openable from any device. It does what the five
scripts in [`../scripts/`](../scripts/) do — browse, search, add, edit, delete, bulk-ingest
attachments, validate, and manage the tag vocabulary — with nothing running on your desktop.

**Everything here is additive.** `scripts/`, every `sources.toml`, `sources.json`,
`sources.md`, `allowed_tags.toml` and `tags.toml` are read-only inputs. The desktop workflow
keeps working untouched and in parallel.

## How it works

A static page on Cloudflare Pages talking straight to the GitHub API:

```
Browser (installable on a phone home screen)
  ├── reads   → Contents API   sources.json, sources.toml, allowed_tags.toml
  ├── reads   → Trees API      Attachments/** listing, and file-existence checks
  ├── writes  → Git Data API   blob → tree → commit → update ref, atomic
  └── auth    → /api/oauth     the one server-side step, holds the client secret
```

Every write is **one commit** containing the target `sources.toml`, the regenerated
`sources.json` and that folder's `sources.md` — the same shape as commit `f7084bc`, minus
the `add_source.py` form residue that commit also carried.

Writes are a compare-and-swap against the branch tip: if the desktop committed since the
page loaded, the write is refused rather than built on stale content.

## The port, and how it is kept honest

`src/lib/` is a second implementation of the Python in TypeScript, so that everything is
instant rather than waiting on CI. Two implementations can drift, so:

- **The field schema is generated, not transcribed.** `scripts/gen-schema.py` imports
  `../scripts/common/lib.py` read-only and emits `src/schema/schema.generated.ts`.
  `FIELD_SPEC`, `REQUIRED_FIELDS`, `CHECKED_VALUES` and the length caps still have exactly
  one definition.
- **`scripts/py-oracle.py`** runs the real Python and dumps what it computes as JSON.
  `test/parity.test.ts` runs the TS over the same live repo and compares: all three
  validator tiers as exact strings, every `sources.md` byte for byte, every `sources.json`
  record, and ten search queries ranked.

```bash
npm run check     # schema is current + the full suite
```

Deliberate divergences and the repo facts the port had to accommodate are in
[`docs/parity-notes.md`](docs/parity-notes.md). Read it before changing anything in
`src/lib/`.

## Writes never reserialize

The Python round-trips through tomlkit, which preserves comments and hand-edited spacing.
There is no tomlkit here, so fidelity comes from a stricter rule: **only the bytes of the
entry being changed are ever touched.** Add appends, edit replaces one table's byte range,
delete cuts one out, and the file's own trailing newlines are put back as they were. The
splice-safety tests prove the containment.

## Setup

### 1. Create a GitHub OAuth App

<https://github.com/settings/developers> → New OAuth App.

- Homepage URL: your Pages URL
- Authorization callback URL: `https://<your-pages-url>/api/oauth`

Keep the client id and generate a client secret. Use a classic **OAuth App**, not a GitHub
App — its token does not expire, which suits a personal tool. The app requests
`public_repo` and nothing else.

### 2. Deploy to Cloudflare Pages

Connect the repo, then:

| Setting | Value |
|---|---|
| Root directory | `web` |
| Build command | `npm run build` |
| Output directory | `dist` |

Environment variables:

| Name | Value | Secret? |
|---|---|---|
| `GITHUB_CLIENT_ID` | the client id | no |
| `GITHUB_CLIENT_SECRET` | the client secret | **yes** |
| `VITE_GITHUB_CLIENT_ID` | the same client id | no (built into the page) |

The build needs `uv` on the build image for `npm run schema`. If that is awkward, commit
`src/schema/schema.generated.ts` (drop its line from `.gitignore`) and change the `build`
script to plain `tsc -b && vite build` — `npm run check` still catches drift locally.

### 3. Local development

```bash
cd web
npm install
cp .env.example .env.local     # add the client id
npm run dev
```

The OAuth function does not run under `vite dev`. Use `npx wrangler pages dev dist` after a
build to exercise sign-in locally, or just develop against the deployed preview.

## Layout

| Path | What it is |
|---|---|
| `src/lib/` | the port: id, paths, toml read/write, validate, search, render-md, export-json |
| `src/lib/github.ts` | Contents / Trees / Git Data access |
| `src/lib/collection.ts` | loads the collection; every write operation returns one commit's files |
| `src/views/` | Browse, Search, Add, Edit, Ingest, Validate, Tags |
| `functions/api/oauth.ts` | the Pages Function that holds the client secret |
| `scripts/gen-schema.py` | generates the TS schema from the Python |
| `scripts/py-oracle.py` | runs the Python and dumps its results for the parity test |
| `scripts/make-icons.mjs` | regenerates the PWA icons in `public/` |

## Known, and left alone

- **Token storage.** The OAuth token lives in `localStorage` so the installed PWA stays
  signed in. That is a real credential on the device, scoped to `public_repo`; Sign out
  clears it. Tightening it means having the Function set an httpOnly cookie and proxy the
  API, at the cost of becoming a full proxy.
- **Ten standing findings** in the collection — four broken `files` paths, five untagged
  auto-added entries, one oversized PDF. They are listed in `docs/parity-notes.md` and are
  meant to be fixed from the Validate and Edit views.
- **`Attachments/Datasets_for_project/tags.toml`** declares `dataset`, which is not in the
  vocabulary, so `update_files.py` skips that folder in silence. The Ingest view says so
  out loud.
- **52 MB of PDFs with no git-lfs.** Uploading more from a phone makes that worse. Migrating
  would rewrite history and touch the existing repo, so it is deliberately out of scope.
- **`../scripts/README.md:36-44`** says to run `python -m scripts.<name>` and calls the
  direct form wrong. It is inverted — the flat imports only resolve under
  `python scripts/add_source.py`. Left alone under the additive constraint.
