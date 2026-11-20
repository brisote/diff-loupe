import { describe, expect, it } from "vitest";
import { formatStructuredFile, isJsonFile, isYamlFile } from "./format";

describe("structured file formatting", () => {
  it("detects json and yaml paths", () => {
    expect(isJsonFile("settings.json")).toBe(true);
    expect(isJsonFile("notes.txt")).toBe(false);
    expect(isYamlFile("application.yml")).toBe(true);
    expect(isYamlFile("config.yaml")).toBe(true);
    expect(isYamlFile("settings.json")).toBe(false);
  });

  it("pretty prints minified JSON", () => {
    const result = formatStructuredFile("data.json", '{"b":1,"a":[true,2]}');
    expect(result).toEqual({
      ok: true,
      text: '{\n  "b": 1,\n  "a": [\n    true,\n    2\n  ]\n}\n',
    });
  });

  it("returns an error for invalid JSON", () => {
    const result = formatStructuredFile("broken.json", '{"a": }');
    expect(result.ok).toBe(false);
  });

  it("pretty prints inline YAML and multi-document YAML", () => {
    const single = formatStructuredFile("app.yml", "server: {port: 8080, host: localhost}");
    expect(single).toEqual({
      ok: true,
      text: "server:\n  port: 8080\n  host: localhost\n",
    });

    const multi = formatStructuredFile("docs.yaml", "a: {b: 1}\n---\nc: [1, 2]\n");
    expect(multi).toEqual({
      ok: true,
      text: "a:\n  b: 1\n---\nc:\n  - 1\n  - 2\n",
    });
  });

  it("preserves YAML comments and explicit null documents", () => {
    const result = formatStructuredFile(
      "config.yaml",
      "# top comment\nserver: {port: 8080}\n---\nnull\n",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("# top comment");
      expect(result.text).toContain("port: 8080");
      expect(result.text).toContain("null");
    }
  });

  it("returns an error for invalid YAML", () => {
    const result = formatStructuredFile("broken.yml", "a: [1, 2\n  b: :");
    expect(result.ok).toBe(false);
  });
});
