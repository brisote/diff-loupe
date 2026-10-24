import { fileExtension, fileName } from "../lib/fileTypes";

const byExtension: Record<string, string> = {
  kt: "kotlin",
  kts: "kotlin",
  java: "java",
  js: "javaScript",
  jsx: "javaScript",
  mjs: "javaScript",
  cjs: "javaScript",
  ts: "typeScript",
  tsx: "typeScript",
  mts: "typeScript",
  cts: "typeScript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rb: "ruby",
  rake: "ruby",
  rs: "rust",
  go: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  toml: "toml",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
  txt: "text",
  log: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  bmp: "image",
  svg: "image",
  zip: "binaryData",
  jar: "binaryData",
  pdf: "binaryData",
  wasm: "binaryData",
  class: "binaryData",
  dylib: "binaryData",
  so: "binaryData",
  exe: "binaryData",
};

const byName: Record<string, string> = {
  Gemfile: "ruby",
  Rakefile: "ruby",
  Dockerfile: "shell",
  Makefile: "shell",
};

export function fileIcon(path: string): string {
  if (path.endsWith("/")) return "dl-i-nodes-folder";
  const named = byName[fileName(path)];
  if (named) return `dl-ft-${named}`;
  const extension = fileExtension(path);
  const type = extension ? byExtension[extension] : undefined;
  return `dl-ft-${type ?? "unknown"}`;
}
