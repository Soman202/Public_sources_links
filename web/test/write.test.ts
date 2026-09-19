/** The mutation paths: append, splice-edit, delete, and the tag vocabulary.
 *
 *  These are the operations that can damage a file, so each one is checked for what it
 *  leaves behind as well as what it changes.
 */

import { describe, expect, it } from "vitest";

import { parseSourceDoc } from "../src/lib/toml-read";
import {
  appendEntry,
  deleteEntry,
  renderSourceBlock,
  tomlString,
  tomlValue,
} from "../src/lib/toml-write";
import { addTag, TagWriteError } from "../src/lib/tags-write";
import { readTags, readTagTypes } from "../src/lib/toml-read";
import { makeId, normalizeUrl, slugify } from "../src/lib/id";
import { pathKey, normalizeRepoPath } from "../src/lib/paths";
import { countWord, pyRepr } from "../src/lib/python";
import { allowedTags, loadRepo, readRepoFile } from "./repo";

const NEW_ENTRY = {
  id: "W3-tes-test-ABC123",
  title: "Test entry",
  importance: 3,
  description: "Added by the test suite.",
  urls: ["https://example.com/a"],
  tags: ["CS", "book"],
  checked: "No",
  files: [],
  platform: "web",
  cost: "free",
  date_editing: "2026-09-19",
  notes: "",
};

describe("serialisation", () => {
  it("escapes backslashes the way the repo's own entries are stored", () => {
    // Education_materials/TP/sources.toml really does hold a Windows-separated path.
    expect(tomlString("Attachments\\TP_materials\\x.pdf")).toBe(
      '"Attachments\\\\TP_materials\\\\x.pdf"',
    );
  });

  it("renders arrays and empties the way build_table does", () => {
    expect(tomlValue([])).toBe("[]");
    expect(tomlValue(["a", "b"])).toBe('["a", "b"]');
    expect(tomlValue(6)).toBe("6");
  });

  it("orders fields by FIELD_ORDER and keeps unknowns at the end", () => {
    const block = renderSourceBlock({ notes: "n", title: "t", surprise: "s", id: "i" });
    expect(block.split("\n")).toEqual([
      "[[source]]",
      'id = "i"',
      'title = "t"',
      'notes = "n"',
      'surprise = "s"',
    ]);
  });
});

describe("append / edit / delete", () => {
  const docs = loadRepo().docs.filter((doc) => doc.entries.length >= 2);

  it("appends an entry without disturbing the ones already there", () => {
    for (const doc of docs) {
      const text = appendEntry(doc.text, NEW_ENTRY);
      const reparsed = parseSourceDoc(doc.path, text);

      expect(reparsed.entries.length).toBe(doc.entries.length + 1);
      for (let i = 0; i < doc.entries.length; i += 1) {
        expect(reparsed.entries[i].entry).toEqual(doc.entries[i].entry);
      }
      expect(reparsed.entries[reparsed.entries.length - 1].entry).toEqual(NEW_ENTRY);
      expect(reparsed.generalNotes).toEqual(doc.generalNotes);
    }
  });

  it("appending then deleting restores the file byte for byte", () => {
    for (const doc of docs) {
      const grown = appendEntry(doc.text, NEW_ENTRY);
      const reparsed = parseSourceDoc(doc.path, grown);
      const added = reparsed.entries[reparsed.entries.length - 1];

      expect(deleteEntry(grown, added.range)).toBe(doc.text);
    }
  });

  it("deletes exactly one entry and leaves the rest intact", () => {
    for (const doc of docs) {
      for (let index = 0; index < doc.entries.length; index += 1) {
        const text = deleteEntry(doc.text, doc.entries[index].range);
        const reparsed = parseSourceDoc(doc.path, text);

        expect(reparsed.entries.length).toBe(doc.entries.length - 1);

        const expected = doc.entries.filter((_, i) => i !== index).map((parsed) => parsed.entry);
        expect(reparsed.entries.map((parsed) => parsed.entry)).toEqual(expected);
      }
    }
  });

  it("round-trips a value through write and read unchanged", () => {
    const doc = docs[0];
    const tricky = {
      ...NEW_ENTRY,
      title: 'Quotes " and \\ backslash',
      description: "Line one\nline two\ttabbed",
      files: ["Attachments\\TP_materials\\x.pdf"],
    };

    const reparsed = parseSourceDoc(doc.path, appendEntry(doc.text, tricky));
    expect(reparsed.entries[reparsed.entries.length - 1].entry).toEqual(tricky);
  });
});

describe("tag vocabulary", () => {
  const text = readRepoFile("scripts/common/allowed_tags.toml");

  it("adds a tag to the flat list and to each chosen group", () => {
    const updated = addTag(text, "quantum", ["science", "math"], allowedTags());

    const tags = readTags(updated);
    expect(tags).toContain("quantum");
    // Everything that was there is still there, in order, with the new tag last.
    expect(tags.slice(0, -1)).toEqual(allowedTags());

    const groups = readTagTypes(updated);
    expect(groups.science).toContain("quantum");
    expect(groups.math).toContain("quantum");
    expect(groups.CS).not.toContain("quantum");

    // Untouched groups are byte-identical.
    expect(readTagTypes(text).CS).toEqual(groups.CS);
  });

  it("refuses a case-insensitive clash", () => {
    expect(() => addTag(text, "llm", ["CS"], allowedTags())).toThrow(TagWriteError);
    expect(() => addTag(text, "  ", ["CS"], allowedTags())).toThrow(TagWriteError);
  });

  it("refuses a tag with no group, which is how a tag goes half-added by hand", () => {
    expect(() => addTag(text, "brandnew", [], allowedTags())).toThrow(/at least one/);
  });
});

describe("helpers", () => {
  it("normalizes urls the way Python's urlsplit/urlunsplit pair does", () => {
    expect(normalizeUrl("https://www.x.com/a/b/")).toBe("//x.com/a/b");
    expect(normalizeUrl("http://x.com/a/b")).toBe("//x.com/a/b");
    expect(normalizeUrl("https://x.com/a?q=1#f")).toBe("//x.com/a");
    expect(normalizeUrl("x.com/a")).toBe("x.com/a");
  });

  it("builds ids in the documented shape", () => {
    const id = makeId("Hello World", ["dev"], 3, true, new Set(), () => 0);
    expect(id).toBe("F3-dev-hell-AAAAAA");
    expect(makeId("", [], 9, false, new Set(), () => 0)).toBe("W9-gen-untl-AAAAAA");
  });

  it("re-rolls an id until it is unique", () => {
    const taken = new Set(["F3-dev-hell-AAAAAA"]);
    let call = 0;
    const id = makeId("Hello", ["dev"], 3, true, taken, () => (call++ < 6 ? 0 : 0.999));
    expect(id).not.toBe("F3-dev-hell-AAAAAA");
  });

  it("slugifies the way the toolkit does", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("---")).toBe("");
  });

  it("treats backslash and forward slash paths as the same file", () => {
    expect(pathKey("Attachments\\TP\\x.pdf")).toBe(pathKey("attachments/tp/x.pdf"));
    expect(normalizeRepoPath("Attachments\\TP\\..\\CS\\x.pdf")).toBe("Attachments/CS/x.pdf");
  });

  it("counts whole words the way Python's \\b does", () => {
    expect(countWord("ML", "HTML and ML and ml")).toBe(2);
    expect(countWord("CS_web", "the CS_web tag")).toBe(1);
    expect(countWord("x", "xx x xx")).toBe(1);
  });

  it("reproduces Python repr for the values findings interpolate", () => {
    expect(pyRepr("plain")).toBe("'plain'");
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr(["a", "b"])).toBe("['a', 'b']");
    expect(pyRepr(5)).toBe("5");
  });
});
