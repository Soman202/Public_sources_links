# Sources Toolkit

Six scripts that keep the link collection honest: one `sources.toml` per folder is the truth,
everything else is generated from it.

- **Requires:** Python 3.9+ (`str.removeprefix`), `tomlkit>=0.12`
- **Run from:** the repo root, always as `python -m scripts.<name>`
- **Truth:** `sources.toml` (hand-edited)
- **Generated:** `sources.md` per folder, `sources.json` at the root — never hand-edit either

---

## Table of Contents

1. [Setup](#1-setup)
2. [The daily loop](#2-the-daily-loop)
3. [The six scripts](#3-the-six-scripts)
4. [The entry schema](#4-the-entry-schema)
5. [Adding a source](#5-adding-a-source)
6. [Editing a source](#6-editing-a-source)
7. [Auditing the whole repo](#7-auditing-the-whole-repo)
8. [Searching and statistics](#8-searching-and-statistics)
9. [Tags](#9-tags)
10. [Generated files](#10-generated-files)
11. [Gotchas](#11-gotchas)

---

## 1. Setup

```bash
uv venv                                  # creates .venv
uv pip install -r requirements.txt       # tomlkit, nothing else
```

Everything runs as a module from the repo root, so the `scripts` package resolves:

```bash
python -m scripts.validate_sources       # right
python scripts/validate_sources.py       # wrong — imports will fail
```

> There are no `__init__.py` files. Imports work through implicit namespace packages plus the
> repo root being on `sys.path`, which `-m` from the repo root gives you and nothing else does.

---

## 2. The daily loop

```bash
python -m scripts.search              # find something, or see the collection's shape
python -m scripts.add_source          # add a link (edit the constants first)
python -m scripts.edite_source        # change an existing one
python -m scripts.validate_sources    # audit everything, then fix the small stuff
```

`add_source` and `edite_source` refresh the generated views themselves. You only need
`export_json` / `render_md` by hand after editing a `sources.toml` directly.

---

## 3. The six scripts

| Script | What it does | Writes? |
|---|---|---|
| `add_source.py` | Validates one new entry, then appends it to a folder's `sources.toml` | Yes, behind `y/N` |
| `edite_source.py` | Finds one entry by id or title, merges your changes, writes it back in place | Yes, behind `y/N` |
| `validate_sources.py` | Audits every `sources.toml`; reports in full, then offers mechanical fixes | Yes, behind `y/N` |
| `search.py` | Ranked search, or collection statistics on an empty prompt | **No** |
| `export_json.py` | Flattens every TOML into `sources.json` at the repo root | Yes, unconditionally |
| `render_md.py` | Writes a browsable `sources.md` next to every `sources.toml` | Yes, unconditionally |

Shared helpers live in `scripts/common/lib.py` — the schema constants, TOML round-tripping,
url normalisation, id generation. The allowed tag vocabulary lives in
`scripts/common/allowed_tags.toml`.

**Nothing writes without an explicit `y`**, except `export_json` and `render_md`, which only
ever rewrite files that are generated in the first place.

---

## 4. The entry schema

Every source is one `[[source]]` table. Fields are written in this order; the toolkit reorders
them for you when it rebuilds an entry.

| Field | Type | Required | What it holds |
|---|---|---|---|
| `id` | str | generated | Short unique handle — see below |
| `title` | str | **yes** | Display name, also a duplicate-detection key |
| `importance` | int | defaults to `9` | **Lower = more important.** Sorts `sources.md` |
| `description` | str | **yes** | Free prose, up to 10,000 chars |
| `urls` | list[str] | — | Must start with `http://` or `https://` |
| `tags` | list[str] | **yes** | Only tags from `allowed_tags.toml`; **order matters** |
| `checked` | str | **yes** | One of the stages below |
| `files` | list[str] | — | Repo-relative paths to files **already in the repo** |
| `platform` | str | — | Free text |
| `cost` | str | — | Free text, e.g. `free`, `$39 per month` |
| `date_editing` | str | **yes** | `YYYY-MM-DD`, filled in for you |
| `notes` | str | — | Free prose, up to 10,000 chars |

An entry needs **at least one url or one file** — never neither.

**Length caps.** 250 chars for every short text field, 10,000 for `description` and `notes`,
500 per item inside `urls` / `tags` / `files`.

**`checked` stages**, in order of how much you actually know:

```
fully checked | checking | partially checked | slightly checked | first look | No
```

**`id` format** — `{F|W}{importance}-{tag}-{word}-{code}`, e.g. `F3-dev-hell-A1B2C3`:

| Part | Meaning |
|---|---|
| `F` / `W` | **F**ile (offline) or **W**eb — offline wins when an entry has both |
| `3` | The `importance` value |
| `dev` | `tags[0]` slugified, first 3 chars — this is why tag order matters. Slugifying replaces `_` with `-`, so `CS_web` gives `cs-` |
| `hell` | First 4 chars of the title's first word |
| `A1B2C3` | Six random chars, re-rolled until unique across the repo |

A minimal entry:

```toml
[[source]]
id = "W3-too-simp-K7QM2P"
title = "Simplescraper"
importance = 3
description = "Only text, limited free, has API key, so could be called directly using REST."
urls = ["https://simplescraper.io/"]
tags = ["tool", "CS_web"]
checked = "No"
files = []
platform = "tool"
cost = "$39 per month"
date_editing = "2026-09-05"
notes = ""
```

---

## 5. Adding a source

Edit the two constants near the bottom of `add_source.py`, then run it.

```python
TARGET_FOLDER = "Tools"

ENTRY = {
    "title": "Simplescraper",
    "importance": 3,
    "description": "Only text, limited free, has API key.",
    "urls": ["https://simplescraper.io/"],
    "tags": ["tool", "CS_web"],
    "checked": "No",
    "files": [],
    "platform": "tool",
    "cost": "$39 per month",
    "notes": "",
}
```

```bash
python -m scripts.add_source
```

Leave `id` and `date_editing` out — both are filled in for you and reported as
`Filled in: id -> ..., date_editing -> ...`.

**What happens.** The entry is checked against the same validator the repo-wide audit uses,
with the candidate indexed *after* every existing entry, so a duplicate url or title reports
against the entry that already owns it. Structural or consistency problems refuse the add
outright. Convention problems are listed and you're offered the corrections. Then you see the
finished entry and confirm.

> If a source is a **local file**, put the file in the repo yourself first and reference it by
> its repo-relative path. This script never creates or copies files, and an entry pointing at a
> path that doesn't exist is a structural failure.

> An entry with no tags is refused before anything else runs, and you're shown the tag fields
> to pick from.

---

## 6. Editing a source

Edit the two constants near the bottom of `edite_source.py`, then run it.

```python
FINDING_KEY = "W3-too-simp-K7QM2P"      # an id, or an exact title

NEW_ENTRY = {
    "checked": "first look",
    "notes": "trial ran out",
}
```

```bash
python -m scripts.edite_source
```

Only the fields you list change; everything else keeps its current value, and `date_editing`
is bumped for you. The entry keeps its position in the file, and every other entry and comment
in that file is left untouched.

**Lookup order.** `id` is tried alone first, then exact title (case-insensitive). If more than
one entry matches, you get the list and nothing is written — use an id to disambiguate.

> Duplicate checking is deliberately **skipped** here, because an edited entry always collides
> with its own former url and title. If an edit introduces a url that already exists elsewhere,
> only `validate_sources` will catch it. Run the audit after a batch of edits.

---

## 7. Auditing the whole repo

```bash
python -m scripts.validate_sources
```

Everything is reported **before** anything is fixed. Findings come in three tiers, plus a
separate leading section for files that wouldn't parse at all:

| Tier | Meaning | Fixable? |
|---|---|---|
| **Unreadable files** | The TOML wouldn't parse — none of its entries were checked at all | No |
| **Structural anomalies** | Missing required field, wrong type, unknown field, bad url, missing file, no location | No — fix by hand |
| **Consistency gaps** | Duplicate id, title, url or file across the repo | No — fix by hand |
| **Convention / small-fix candidates** | Whitespace, casing, tag dupes, blank `checked`, missing `importance`, oversized file | Those marked `(fixable)` |

Only after the full report are you offered the mechanical fixes, behind a single `y/N`:

```
23 small, mechanical fix(es) available (whitespace, casing, tag dedupe,
blank 'checked', missing importance -> 9). Apply them now? [y/N]
```

Answering `y` applies them and regenerates `sources.json` and every `sources.md`.

**What the fixer will and won't do.** It strips whitespace, recases values towards the
vocabulary's own spelling (`llm` → `LLM`, `no` → `No`), dedupes tags while preserving order,
and defaults a blank or absent `importance` to `9`. It never guesses at typos — an unrecognised
tag is reported and left exactly as written.

> Duplicate urls compare through a normaliser, so `https://www.x.com/` and `http://x.com`
> are the same url. Only the *later* entry of a colliding pair reports, so each pair is
> named once.

> A file over 10 MB is a convention warning, not an error. It's a guideline about what belongs
> in the repo, not a rule the toolkit enforces.

---

## 8. Searching and statistics

```bash
python -m scripts.search
```

One prompt, two behaviours. Type terms to search; press Enter on an empty prompt for
statistics. **This is the only script that writes nothing.**

**Scoring:**

```
score = 4  per query term matching one of the entry's tags
      + (9 - importance)
      + 1  per whole-word occurrence in title, description and notes
```

An entry needs at least one tag or word hit to appear at all — the importance bonus alone
never surfaces anything. A term that is both a tag and a word scores for both. Results show
the breakdown, so you can see where a number came from:

```
   14  Tools  Simplescraper
       tags: tool +4 | words: scraper x1 +1 | importance 3 +6
       https://simplescraper.io/
```

Ties break towards the more important entry, then alphabetically, so ordering is stable between
runs. The top 20 print; the rest are counted in a trailing line (raise `TOP_N` to see them).

**Word matching is whole-word, case-insensitive.** Substring matching would make the short tags
useless — a search for `ML` would hit every `HTML`. Underscores count as word characters, so
`CS_web` and `skill_net` match as the single words they are.

**Statistics** break the collection down by importance, tag, tag field, `checked` stage and
cost — including which allowed tags are going unused, and any tag or `checked` value in use
that isn't in the vocabulary.

---

## 9. Tags

The vocabulary is fixed and lives in `scripts/common/allowed_tags.toml`. A tag outside it is a
structural finding — the point is to stop `llm` and `LLM` becoming two different things.

**Tag order matters.** `tags[0]` is the primary tag and feeds the entry's `id`. The toolkit
never sorts tags.

**Tag fields** group the 33 tags into shortlists, so you're offered a handful rather than all
of them. Membership overlaps on purpose — `LLM` is both a CS tag and a tool tag:

| Field | Tags |
|---|---|
| `math` | math_anal, math_comb, math_prob, math |
| `science` | science_data, research |
| `CS` | CS_web, CS, CS_systems, comp, algorithms, ML_model, ML, LLM, docs |
| `navigation` | navigation, curriculum, skill_net, research |
| `LLM` | LLM, free, evaluator, generator |
| `tool` | tool, LLM, ML_model, free, API |
| `general` | knowledge, exercises, studying, data, challenges |
| `format` | visuals, audio, image |
| `job` | job |
| `data` | data |
| `other` | other |

Fields are a browsing aid only. The flat `[[tags]]` list is the single vocabulary the validator
checks against.

**To add a tag:** edit `allowed_tags.toml` by hand — add it to the flat list *and* to at least
one field. `lib.add_tag()` exists to do this safely but no script currently calls it.

---

## 10. Generated files

| File | Written by | Contents |
|---|---|---|
| `<folder>/sources.md` | `render_md.py` | That folder's entries, sorted by importance, for browsing |
| `sources.json` (repo root) | `export_json.py` | Every entry flattened into one list, stamped with its `folder` |

Both are **derived artifacts — never hand-edit them.** Your changes are overwritten on the next
render. Every path in the toolkit that mutates a TOML regenerates afterwards, so the views
can't go stale: `add_source` and `edite_source` rewrite `sources.json` plus the one folder's
`sources.md`; the audit's fix pass rewrites `sources.json` and *every* `sources.md`.

To regenerate by hand after editing a `sources.toml` directly:

```bash
python -m scripts.export_json     # rewrites sources.json
python -m scripts.render_md       # rewrites every sources.md
```

`sources.json` carries a `generated_at` date and a `count`, and each record gets a `folder`
holding the full relative path (`Tools/Free tools`, not just `Free tools`) so nested folders
stay distinguishable once everything is in one list.

---

## 11. Gotchas

**A mistyped scalar crashes the audit instead of reporting it.** `id = 5` or `title = 5` in a
hand-edited TOML raises `AttributeError` before a single finding prints, because the duplicate
index is built before validation runs. Keep scalars quoted.

**`sources.md` doesn't show `id`.** But `edite_source` prefers an id for `FINDING_KEY`. Read
ids out of `sources.toml` or `sources.json`.

**Importance can outweigh a tag match in search.** An importance-0 entry with one word hit
(`0 + 9 + 1 = 10`) ranks above an importance-9 entry with two tag hits (`8 + 0 + 0 = 8`).
It isn't purely a tie-breaker.

**`importance` isn't range-checked.** The scale is 0–9 by convention only; `importance = 20`
validates clean and scores negative in search.

**`add_source` and `edite_source` are configured by editing the script.** Every use dirties a
tracked file. Reset the constants after a run, or your next `git status` is noise.

**`cost` is free text.** `search` buckets it into free / unspecified / other and prints the raw
"other" strings unchanged — `$39 per month (6,00 cloud credits)` is not a number and isn't
treated as one.

**tomlkit, not tomllib.** The whole toolkit round-trips through `tomlkit` so your comments,
key order and formatting survive being rewritten. Don't swap in `tomllib` for "just reading" —
`save_toml` re-inserts the blank line before each `[[source]]` that tomlkit drops, and a plain
loader would flatten the files on the next write.
