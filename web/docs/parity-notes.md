# Parity notes

The TypeScript in `src/lib/` is a second implementation of `scripts/`. This file records
every place the two deliberately differ, and the facts about the repo that the port had to
accommodate. `npm run check` is what keeps the rest honest.

## How parity is enforced

`scripts/py-oracle.py` imports the Python toolkit read-only and dumps what it computes as
JSON. `test/parity.test.ts` runs the TS over the same live repo and compares:

| Check | What must match |
|---|---|
| Validator | all three tiers, set for set, as exact strings |
| Renderer | every `sources.md`, byte for byte |
| Exporter | every `sources.json` record |
| Search | ranked results for 10 queries (score, folder, title) |
| Splice safety | bytes outside an edited entry are unchanged; the result reparses |

The repo is **not** clean, and that is the point: the ten standing findings below have to
appear identically on both sides for the test to pass.

`scripts/gen-schema.py --check` fails if `common/lib.py` changed without the TS schema being
regenerated, so the field table cannot drift silently.

## Deliberate divergences

### 1. A mistyped scalar reports instead of crashing

`title = 5` or `id = 5` makes the Python audit raise `AttributeError` before a single
finding prints, because `build_index` calls `.strip()` on the title before `validate` ever
runs. The TS reports it as a structural finding and carries on.

Strictly better, and not replicated. It cannot show up as a parity failure on a corpus that
does not contain a mistyped scalar — which the live repo does not.

Affects: `entryLabel`, `fieldNormalize` (tags), `entrySimilar`.

### 2. `importance` is not range-checked, and stays that way

`importance = 20` validates clean in Python and scores negative in search. The TS validator
keeps that behaviour exactly. The **form** constrains input to 0–9, which prevents the
problem at the point of entry without changing validator semantics.

### 3. `pathKey` canonicalises, it does not resolve

`update_files.py:49` calls `os.path.normcase(str((repo_root() / field).resolve()))`. There
is no filesystem in the browser, so `paths.ts` canonicalises the string instead: backslashes
to forward slashes, `.`/`..` resolved, lowercased.

This matches Python **on Windows**, which is where the toolkit is run. On Linux a backslash
is a legal filename character, so `Path("a\\b").resolve()` would not split it there. The
repo holds both separator styles (see below), so every `files` comparison goes through this.

### 4. Unreadable-file messages differ in wording

Python keeps tomlkit's parse error verbatim; the TS keeps `toml-eslint-parser`'s. Both carry
line and column. The parity test compares the *count* of unreadable files, not the text.

## Faithful quirks — do not "fix" these

**Two different folder spellings, on purpose.** `validate_sources.py` uses the short folder
*name* (`path.parent.name`) in findings and in `build_index`, while `export_json.py`,
`search.py` and `render_md.py` use the full relative path. So `Tools` and `Tools/Free tools`
both report as `[Tools]` in a finding but stay distinct in `sources.json`. `paths.ts`
exposes both as `folderOf` and `folderName`, and the parity test depends on the difference.

**Duplicate detection compares raw file strings.** `build_index` keys the `file` index on
`file_field.strip()`, not a normalised path, so `Attachments\x.pdf` and `Attachments/x.pdf`
do **not** collide as duplicates. Only `listed_files` in `update_files.py` goes through
`pathKey`. The two are kept separate in the port for this reason.

**`isinstance(True, int)` is `True`.** A boolean passes an `int` field in Python, so
`matchesType` accepts booleans for `integer`, and `importanceOf` returns 1/0 for them.

**Tag order is never sorted.** `tags[0]` is the primary tag and feeds the entry's id.

**`len()` counts code points.** `pyLen` is used for every length message so an emoji in a
title cannot make the two implementations disagree about "N chars, over the limit".

**`\b` is Python's, not JavaScript's.** `countWord` applies Python's boundary rule directly
(word-ness of the adjacent characters differs) instead of using a JS regex, whose `\b` is
ASCII-only without the `u` flag and behaves differently for terms starting with punctuation.

## Line endings

`core.autocrlf=true` is set on this repo and there is no `.gitattributes`. So:

- **git stores LF** — verified with `git show HEAD:Tools/sources.toml`
- **the Windows working tree is CRLF**
- **the GitHub API serves and accepts the blob**, so the web app reads and writes **LF**
- the desktop keeps checking out CRLF, and the Python keeps writing CRLF

The two coexist without conflict, but a web commit that sent CRLF would rewrite every line
of the file. `toml-write.ts` detects and reuses whatever newline the text it was handed
already uses, so neither assumption can leak into a commit.

The tests read the working tree (CRLF) and parse it fine — line endings do not change parsed
values, and the generators build their output with `\n` on both sides.

## Standing findings in the live repo (10)

These are real data problems, left for the Validate view to fix from the UI rather than
edited into the repo beforehand. They double as the parity test's fixtures.

**Four broken `files` references** in `Attachments/sources.toml`, from the `Docs/`
reorganisation in `4000dbb`:

- `Attachments/AI prompts for studying/Multiple_studying_formats.md`
- `Attachments/AI prompts for studying/Prompts_for_studying.md`
- `Attachments/GitHub_docs/git-commands-reference.md`
- `Attachments/Python_libraries_docs/tomlkit-guide.md`

**Five entries missing `tags`**, all auto-added by `update_files.py` from folders with no
usable `tags.toml`: `datamining clusterisation`, `grid glossary leveled`, `Modelling
Renewable Curtailment…`, `run-colab-on-a-virtual-space`, `Wind Dispatch Tool Constraint
Group Overview`.

**One oversized file**: `Attachments/TCD_books_JS/Physics/Ashcroft_Mermin_eng.pdf` at 16.0 MB,
over the 10 MB convention guideline.

Related but not a finding: `Attachments/Datasets_for_project/tags.toml` declares
`tags = ["dataset"]`, which is not in the vocabulary (the allowed tag is `data`).
`update_files.py` skips every file below that folder in silence. The Ingest view should say
so out loud.

## Entries not in canonical write format (12)

`npm run test` prints these. They are hand-written entries whose spacing differs from what
`build_table` produces — `importance=6` rather than `importance = 6`, for instance. tomlkit
preserves that spacing; the TS renderer does not.

This is contained, not fixed: splice-editing only rewrites the entry being changed, so
editing one of these reformats that entry's lines and nothing else. The splice-safety test
proves the containment. Entries affected live in `AI_cources`, `CS_cources`,
`Challenges&competitions`, `Fun&visuals`, `Job_applications` and `Tools`.
