import type { Definition, List, Root, RootContent } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type Block = {
  kind: string;
  node: RootContent;
  list?: { ordered: boolean; start: number | null; last: boolean };
  text: string;
  key: string;
  lines: [number, number];
  definitions: Definition[];
};

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);

export function parse(text: string): Root {
  return parser.runSync(parser.parse(text)) as Root;
}

export function plain(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = (node as { value?: unknown }).value;
  if (typeof value === "string") return value;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return "";
  return children.map(plain).join(" ");
}

export function withoutPositions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutPositions);
  if (!node || typeof node !== "object") return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== "position") copy[key] = withoutPositions(value);
  }
  return copy;
}

function block(node: RootContent, definitions: Definition[], list?: List, index = 0): Block {
  const kind = node.type === "listItem" ? `listItem:${list?.ordered ? "ol" : "ul"}` : node.type;
  return {
    kind,
    node,
    list: list
      ? {
          ordered: Boolean(list.ordered),
          start: list.ordered ? (list.start ?? 1) + index : null,
          last: index === list.children.length - 1,
        }
      : undefined,
    text: plain(node).replace(/\s+/g, " ").trim(),
    key: `${kind}|${JSON.stringify(withoutPositions(node))}`,
    lines: [node.position?.start.line ?? 0, node.position?.end.line ?? 0],
    definitions,
  };
}

export function blocks(root: Root): Block[] {
  const definitions = root.children.filter((node) => node.type === "definition");
  return root.children.flatMap((node) =>
    node.type === "list"
      ? node.children.map((item, index) => block(item, definitions, node, index))
      : [block(node, definitions)],
  );
}
