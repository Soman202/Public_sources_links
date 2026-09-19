"""Find sources by tag or word, ranked by weight -- or show what the collection looks like.

Two things, behind one prompt. Type search terms to get matching entries ordered by score;
press Enter on an empty prompt to get the collection statistics instead.

    score = 4 per query term matching one of the entry's tags
          + (9 - importance)
          + 1 per word occurrence in title, description and notes

The importance bonus only ever breaks ties -- an entry needs a real tag or word hit to
appear at all. A term that is both a tag and a word scores for both.

This is the one script in the toolkit that writes nothing: no TOML is touched and no
derived view is regenerated.

Run: python scripts/search.py
"""

from __future__ import annotations

from collections import Counter
import re

from render_md import importance_of
from common.lib import (
    CHECKED_VALUES,
    as_list,
    entry_label,
    load_all_docs,
    read_tag_types,
    read_tags,
    repo_root,
)

TAG_WEIGHT = 4       # what one query term matching one of the entry's tags is worth
IMPORTANCE_BASE = 9  # importance bonus is IMPORTANCE_BASE - importance, so 9 scores 0
TOP_N = 20           # results shown; the rest are counted in a trailing line


def collect_entries() -> tuple[list[tuple], int, list[str]]:
    """Flatten every sources.toml into (entry, folder) pairs, plus a file count and the
    files that wouldn't parse.

    folder is the full relative path, not just the folder name, so Tools and
    Tools/Free tools stay distinguishable once every entry is in one list.
    """
    docs, unreadable = load_all_docs()

    entries = []
    for path, doc in docs.items():
        folder = path.parent.relative_to(repo_root()).as_posix()
        for entry in doc.get("source") or []:
            entries.append((entry, folder))

    # Unreadable files are counted too -- "17 across 12 files" shouldn't quietly shrink
    # just because one of them failed to parse.
    return entries, len(docs) + len(unreadable), unreadable


# --- search ---------------------------------------------------------------------------

def haystack(entry) -> str:
    """The text a plain word is searched in: the three prose fields, joined."""
    return "\n".join(
        value for value in (entry.get(field) for field in ("title", "description", "notes"))
        if isinstance(value, str)
    )


def count_word(term: str, text: str) -> int:
    """Whole-word occurrences of term in text, case-insensitive.

    Whole-word rather than substring because the short tags are the ones that would suffer:
    a substring search for "ML" hits every "HTML". Underscores are word characters, so
    "CS_web" and "skill_net" still match as the single words they are.
    """
    return len(re.findall(rf"\b{re.escape(term)}\b", text, re.IGNORECASE))


def score_entry(entry, terms: list[str]) -> tuple[int, list[str], list[tuple[str, int]]]:
    """Score one entry. Returns (score, tags hit, [(word, occurrences)]) -- the breakdown
    is kept so the result line can show where the number came from."""
    tags = {tag.lower() for tag in as_list(entry.get("tags")) if isinstance(tag, str)}
    text = haystack(entry)

    tag_hits = [term for term in terms if term.lower() in tags]
    word_hits = [(term, count) for term in terms if (count := count_word(term, text))]

    score = (
        TAG_WEIGHT * len(tag_hits)
        + (IMPORTANCE_BASE - importance_of(entry))
        + sum(count for _, count in word_hits)
    )
    return score, tag_hits, word_hits


def search(entries: list[tuple], terms: list[str]) -> list[tuple]:
    """Every entry with at least one tag or word hit, best first."""
    matches = []
    for entry, folder in entries:
        score, tag_hits, word_hits = score_entry(entry, terms)
        if tag_hits or word_hits:
            matches.append((score, entry, folder, tag_hits, word_hits))

    # Ties break towards the more important entry, then alphabetically, so the order is
    # stable between runs rather than falling back to whatever the glob returned.
    matches.sort(key=lambda m: (-m[0], importance_of(m[1]), entry_label(m[1]).lower()))
    return matches


def print_results(matches: list[tuple], terms: list[str]) -> None:
    if not matches:
        print(f"\nNo matches for {' '.join(terms)!r}.")
        return

    print(f"\n== RESULTS ({len(matches)}) ==")
    for score, entry, folder, tag_hits, word_hits in matches[:TOP_N]:
        importance = importance_of(entry)

        parts = []
        if tag_hits:
            parts.append(f"tags: {', '.join(tag_hits)} +{TAG_WEIGHT * len(tag_hits)}")
        if word_hits:
            words = ", ".join(f"{term} x{count}" for term, count in word_hits)
            parts.append(f"words: {words} +{sum(c for _, c in word_hits)}")
        parts.append(f"importance {importance} +{IMPORTANCE_BASE - importance}")

        print(f"\n{score:>5}  {folder}  {entry_label(entry)}")
        print(f"       {' | '.join(parts)}")
        for url in as_list(entry.get("urls")):
            print(f"       {url}")
        for file_field in as_list(entry.get("files")):
            print(f"       {file_field}")

    if len(matches) > TOP_N:
        print(f"\n  ... and {len(matches) - TOP_N} more (raise TOP_N to see them).")


# --- statistics -----------------------------------------------------------------------

def stats_importance(entries: list[tuple]) -> Counter:
    return Counter(importance_of(entry) for entry, _ in entries)


def stats_tags(entries: list[tuple]) -> Counter:
    counts = Counter()
    for entry, _ in entries:
        counts.update(tag for tag in as_list(entry.get("tags")) if isinstance(tag, str))
    return counts


def stats_tag_fields(entries: list[tuple]) -> tuple[Counter, int]:
    """Count entries per tag field, plus how many fall into no field at all.

    An entry counts once in a field if any of its tags belongs there. The fields overlap by
    design, so this does not sum to the entry count.
    """
    fields = read_tag_types()
    counts = Counter()
    unfiled = 0

    for entry, _ in entries:
        tags = {tag for tag in as_list(entry.get("tags")) if isinstance(tag, str)}
        hit = [field for field, members in fields.items() if tags & set(members)]
        counts.update(hit)
        if not hit:
            unfiled += 1

    return counts, unfiled


def stats_checked(entries: list[tuple]) -> Counter:
    return Counter((entry.get("checked") or "").strip() for entry, _ in entries)


def stats_cost(entries: list[tuple]) -> tuple[Counter, list[str]]:
    """Bucket cost into free / unspecified / other, keeping the raw "other" strings.

    cost is free text, so anything that isn't blank or the word "free" is left as written
    rather than guessed at -- a "$39 per month (6,00 cloud credits)" is not a number.
    """
    counts = Counter()
    other = []

    for entry, _ in entries:
        cost = (entry.get("cost") or "").strip()
        if not cost:
            counts["unspecified"] += 1
        elif cost.lower() == "free":
            counts["free"] += 1
        else:
            counts["other"] += 1
            other.append(cost)

    return counts, sorted(other)


def print_stats(entries: list[tuple], file_count: int) -> None:
    print(f"\n== ENTRIES ({len(entries)} across {file_count} file(s)) ==")
    if not entries:
        return

    importance = stats_importance(entries)
    print("\n== BY IMPORTANCE ==        (lower = more important)")
    for value in sorted(importance):
        print(f"  {value}   {importance[value]}")

    allowed = read_tags()
    tags = stats_tags(entries)
    unused = [tag for tag in allowed if tag not in tags]
    print(f"\n== BY TAG ==               ({len(tags)} of {len(allowed)} allowed tags in use)")
    for tag, count in sorted(tags.items(), key=lambda item: (-item[1], item[0].lower())):
        print(f"  {tag:<14} {count}")
    if unused:
        print(f"  ({len(unused)} unused: {', '.join(unused)})")
    # A tag in use that isn't in the vocabulary is the validator's finding, not ours, but
    # it would otherwise sit in the table above looking official.
    unknown = [tag for tag in tags if tag not in allowed]
    if unknown:
        print(f"  (not in allowed_tags.toml: {', '.join(sorted(unknown))})")

    fields, unfiled = stats_tag_fields(entries)
    print("\n== BY TAG FIELD ==         (fields overlap; an entry can count in several)")
    for field, count in sorted(fields.items(), key=lambda item: (-item[1], item[0].lower())):
        print(f"  {field:<14} {count}")
    print(f"  {'(no field)':<14} {unfiled}")

    checked = stats_checked(entries)
    print("\n== BY CHECKED ==")
    for stage in CHECKED_VALUES:
        print(f"  {stage:<20} {checked.get(stage, 0)}")
    off_vocabulary = {stage: n for stage, n in checked.items() if stage not in CHECKED_VALUES}
    for stage, count in sorted(off_vocabulary.items()):
        print(f"  {(stage or '(blank)'):<20} {count}  <- not a CHECKED_VALUES stage")

    cost, other = stats_cost(entries)
    print("\n== BY COST ==")
    for bucket in ("free", "unspecified", "other"):
        print(f"  {bucket:<14} {cost.get(bucket, 0)}")
    for raw in other:
        print(f"    - {raw}")


# --- entry point ----------------------------------------------------------------------

def main() -> None:
    entries, file_count, unreadable = collect_entries()
    for failure in unreadable:
        print(f"  skipped (unreadable): {failure}")

    terms = input("Search terms (blank for statistics): ").split()

    if terms:
        print_results(search(entries, terms), terms)
    else:
        print_stats(entries, file_count)


if __name__ == "__main__":
    main()
