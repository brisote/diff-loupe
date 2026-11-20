import { parseAllDocuments } from "yaml";
import { fileExtension } from "../lib/fileTypes";

export type FormatResult = { ok: true; text: string } | { ok: false; error: string };

export function isJsonFile(path: string): boolean {
  return fileExtension(path) === "json";
}

export function isYamlFile(path: string): boolean {
  const ext = fileExtension(path);
  return ext === "yml" || ext === "yaml";
}

export function isFormattableFile(path: string): boolean {
  return isJsonFile(path) || isYamlFile(path);
}

export function formatStructuredFile(path: string, text: string): FormatResult {
  if (isJsonFile(path)) {
    try {
      const parsed: unknown = JSON.parse(text);
      return { ok: true, text: `${JSON.stringify(parsed, null, 2)}\n` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid JSON syntax.",
      };
    }
  }
  if (isYamlFile(path)) {
    try {
      const docs = parseAllDocuments(text);
      for (const doc of docs) {
        if (doc.errors.length > 0) {
          return { ok: false, error: doc.errors[0]?.message ?? "Invalid YAML syntax." };
        }
      }
      if (docs.length === 0) return { ok: true, text: "" };
      const formatted = docs
        .map((doc, index) => {
          const part = doc.toString({ indent: 2, collectionStyle: "block" }).trimEnd();
          if (index > 0 && !part.startsWith("---")) {
            return `---\n${part}`;
          }
          return part;
        })
        .join("\n");
      return { ok: true, text: formatted ? `${formatted}\n` : "" };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid YAML syntax.",
      };
    }
  }
  return { ok: true, text };
}
