import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { languageKey, loadLanguage, syntaxClasses, syntaxHighlightStyle } from "./syntax";

describe("syntax highlighting", () => {
  it("resolves language keys for common extensions", () => {
    expect(languageKey("main.kt")).toBe("kt");
    expect(languageKey("script.kts")).toBe("kt");
    expect(languageKey("index.ts")).toBe("ts");
    expect(languageKey("unknown.xyz")).toBeNull();
  });

  it("highlights Kotlin backtick test names without breaking subsequent syntax", async () => {
    const extension = await loadLanguage("ServiceTest.kt");
    expect(extension).not.toBeNull();
    if (!extension) return;

    const doc = [
      "@Test",
      "fun `Should give the caller's contexts back to the listeners that run after it`() {",
      '    val analyticsContext = AnalyticsContext(source = "test")',
      "    CallContextHolder.context.spaceId = spaceId",
      "}",
      "",
      "@Test",
      "fun `Should link an automatic insight created through entity operations`() {",
      "    val created = createAutomaticInsight(noteId)",
      "}",
    ].join("\n");

    const state = EditorState.create({
      doc,
      extensions: [extension, syntaxClasses],
    });

    const tree = ensureSyntaxTree(state, doc.length, 1000);
    expect(tree).not.toBeNull();
    if (!tree) return;

    const spans: { text: string; cls: string }[] = [];
    highlightTree(tree, syntaxHighlightStyle, (from, to, cls) => {
      spans.push({ text: doc.slice(from, to), cls });
    });

    const keywords = spans.filter((s) => s.cls === "syn-kw").map((s) => s.text);
    expect(keywords).toContain("fun");
    expect(keywords).toContain("val");

    const strings = spans.filter((s) => s.cls === "syn-str").map((s) => s.text);
    expect(strings).toEqual(['"test"']);

    const metas = spans.filter((s) => s.cls === "syn-meta").map((s) => s.text);
    expect(metas).toEqual(["@Test", "@Test"]);
  });

  it("confines Kotlin character literals to a single line", async () => {
    const extension = await loadLanguage("CharTest.kt");
    expect(extension).not.toBeNull();
    if (!extension) return;

    const doc = ["val ch = 'a'", "val num = 42"].join("\n");

    const state = EditorState.create({
      doc,
      extensions: [extension, syntaxClasses],
    });

    const tree = ensureSyntaxTree(state, doc.length, 1000);
    expect(tree).not.toBeNull();
    if (!tree) return;

    const spans: { text: string; cls: string }[] = [];
    highlightTree(tree, syntaxHighlightStyle, (from, to, cls) => {
      spans.push({ text: doc.slice(from, to), cls });
    });

    const numbers = spans.filter((s) => s.cls === "syn-num").map((s) => s.text);
    expect(numbers).toEqual(["42"]);
  });
});
