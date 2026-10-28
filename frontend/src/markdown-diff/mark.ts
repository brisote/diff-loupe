import { diffArrays, diffWordsWithSpace } from "diff";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type {
  Code,
  List,
  ListItem,
  Paragraph,
  Parents,
  PhrasingContent,
  RootContent,
  Table,
  TableRow,
} from "mdast";
import { toHast } from "mdast-util-to-hast";
import { type Block, plain, withoutPositions } from "./blocks";
import type { Row } from "./match";

export type Marked = {
  left?: HastRoot;
  right?: HastRoot;
  merged: HastRoot;
  whole: boolean;
};

type Unit = { key: string; node: PhrasingContent; link?: { url: string; text: string } };

type Inline = { left: PhrasingContent[]; right: PhrasingContent[]; merged: PhrasingContent[] };

function mark(name: "del" | "ins", children: PhrasingContent[]): PhrasingContent {
  return { type: "emphasis", data: { hName: name }, children } as PhrasingContent;
}

function linkMark(previous: string): PhrasingContent {
  return {
    type: "emphasis",
    data: {
      hName: "span",
      hProperties: { className: ["dl-md-linkmark"], title: `Changed from ${previous}` },
    },
    children: [],
  } as PhrasingContent;
}

function units(
  children: PhrasingContent[],
  wrap = (node: PhrasingContent) => node,
  style = "",
): Unit[] {
  return children.flatMap((child): Unit[] => {
    if (child.type === "text") {
      return child.value
        .split(/(\s+)/)
        .filter((piece) => piece.length > 0)
        .map((piece) => ({
          key: `${style}t:${piece}`,
          node: wrap({ type: "text", value: piece }),
        }));
    }
    if (child.type === "emphasis" || child.type === "strong" || child.type === "delete") {
      const type = child.type;
      return units(
        child.children,
        (node) => wrap({ type, children: [node] } as PhrasingContent),
        `${style}${type}/`,
      );
    }
    if (child.type === "link" || child.type === "image") {
      const text = child.type === "link" ? plain(child) : (child.alt ?? "");
      return [
        {
          key: `${style}${child.type}:${child.url}|${text}`,
          node: wrap(child),
          link: { url: child.url, text: `${style}${child.type}:${text}` },
        },
      ];
    }
    const identifier = "identifier" in child ? `${child.identifier}|` : "";
    return [{ key: `${style}${child.type}:${identifier}${plain(child)}`, node: wrap(child) }];
  });
}

export function inline(a: PhrasingContent[], b: PhrasingContent[]): Inline {
  const before = units(a);
  const after = units(b);
  const out: Inline = { left: [], right: [], merged: [] };
  let l = 0;
  let r = 0;
  const changes = diffArrays(
    before.map((unit) => unit.key),
    after.map((unit) => unit.key),
  );
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (!change) continue;
    const count = change.count ?? change.value.length;
    if (!change.added && !change.removed) {
      const same = after.slice(r, r + count).map((unit) => unit.node);
      out.left.push(...before.slice(l, l + count).map((unit) => unit.node));
      out.right.push(...same);
      out.merged.push(...same);
      l += count;
      r += count;
      continue;
    }
    const next = changes[index + 1];
    if (change.removed && next?.added) {
      const removed = before.slice(l, l + count);
      const nextCount = next.count ?? next.value.length;
      const added = after.slice(r, r + nextCount);
      const relinked =
        removed.length === 1 &&
        added.length === 1 &&
        removed[0]?.link &&
        added[0]?.link &&
        removed[0].link.text === added[0].link.text;
      if (relinked && removed[0]?.link && added[0]) {
        out.left.push(removed[0].node);
        out.right.push(added[0].node, linkMark(removed[0].link.url));
        out.merged.push(added[0].node, linkMark(removed[0].link.url));
      } else {
        const gone = removed.map((unit) => unit.node);
        const fresh = added.map((unit) => unit.node);
        out.left.push(mark("del", gone));
        out.right.push(mark("ins", fresh));
        out.merged.push(mark("del", gone), { type: "text", value: " " }, mark("ins", fresh));
      }
      l += count;
      r += nextCount;
      index += 1;
      continue;
    }
    if (change.removed) {
      const gone = before.slice(l, l + count).map((unit) => unit.node);
      out.left.push(mark("del", gone));
      out.merged.push(mark("del", gone));
      l += count;
    } else {
      const fresh = after.slice(r, r + count).map((unit) => unit.node);
      out.right.push(mark("ins", fresh));
      out.merged.push(mark("ins", fresh));
      r += count;
    }
  }
  return out;
}

function visible(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(visible);
  if (!node || typeof node !== "object") return node;
  const typed = node as { type?: string; value?: string; identifier?: string };
  if (typed.type === "html") {
    return { type: "inlineCode", value: typed.value ?? "" };
  }
  if (typed.type === "footnoteReference") {
    return { type: "text", value: `[^${typed.identifier ?? ""}]` };
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) copy[key] = visible(value);
  return copy;
}

function htmlAsCode(node: RootContent): RootContent {
  if (node.type === "html" || node.type === "yaml") {
    return { type: "code", lang: node.type === "yaml" ? "yaml" : null, value: node.value };
  }
  if (node.type === "definition") {
    const title = node.title ? ` "${node.title}"` : "";
    return {
      type: "paragraph",
      children: [
        { type: "inlineCode", value: `[${node.label ?? node.identifier}]: ${node.url}${title}` },
      ],
    };
  }
  if (node.type === "footnoteDefinition") {
    const children = visible(node.children) as RootContent[];
    const [first, ...rest] = children;
    const label: PhrasingContent = { type: "text", value: `[^${node.label ?? node.identifier}]: ` };
    const head: RootContent =
      first?.type === "paragraph"
        ? { ...first, children: [label, ...first.children] }
        : { type: "paragraph", children: [label] };
    return {
      type: "blockquote",
      children: [head, ...(first?.type === "paragraph" ? rest : children)],
    } as RootContent;
  }
  return visible(node) as RootContent;
}

function hast(original: RootContent, block: Block): HastRoot {
  const node = htmlAsCode(original);
  const content: RootContent =
    node.type === "listItem"
      ? ({
          type: "list",
          ordered: block.list?.ordered ?? false,
          start: block.list?.start ?? null,
          spread: false,
          children: [node],
        } as List)
      : node;
  const tree = toHast(
    { type: "root", children: [content, ...block.definitions] },
    {
      handlers: {
        delete: (state, deleted) => ({
          type: "element",
          tagName: "s",
          properties: {},
          children: state.all(deleted),
        }),
      },
    },
  );
  return (tree.type === "root" ? tree : { type: "root", children: [tree] }) as HastRoot;
}

function onlyParagraph(node: RootContent): Paragraph | null {
  const children = (node as Parents).children ?? [];
  const only = children.length === 1 ? children[0] : undefined;
  return only?.type === "paragraph" ? only : null;
}

function withInline<T extends RootContent>(node: T, children: PhrasingContent[]): T {
  if (node.type === "paragraph" || node.type === "heading") return { ...node, children };
  const paragraph = onlyParagraph(node);
  return { ...node, children: [{ ...paragraph, children }] } as T;
}

function phrasing(node: RootContent): PhrasingContent[] | null {
  if (node.type === "paragraph" || node.type === "heading") return node.children;
  if (node.type === "listItem" || node.type === "blockquote") {
    return onlyParagraph(node)?.children ?? null;
  }
  return null;
}

function span(className: string | null, value: string): ElementContent {
  if (!className) return { type: "text", value };
  const name = className === "del" ? "del" : "ins";
  return { type: "element", tagName: name, properties: {}, children: [{ type: "text", value }] };
}

function code(node: Code, children: ElementContent[]): HastRoot {
  const pre: Element = {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: node.lang ? { className: [`language-${node.lang}`] } : {},
        children,
      },
    ],
  };
  return { type: "root", children: [pre] };
}

function codeDiff(a: Code, b: Code): Marked {
  const left: ElementContent[] = [];
  const right: ElementContent[] = [];
  const merged: ElementContent[] = [];
  for (const part of diffWordsWithSpace(a.value, b.value)) {
    if (part.removed) {
      left.push(span("del", part.value));
      merged.push(span("del", part.value));
    } else if (part.added) {
      right.push(span("ins", part.value));
      merged.push(span("ins", part.value));
    } else {
      left.push(span(null, part.value));
      right.push(span(null, part.value));
      merged.push(span(null, part.value));
    }
  }
  if ((a.lang ?? "") !== (b.lang ?? "")) {
    const marker: ElementContent = {
      type: "element",
      tagName: "span",
      properties: {
        className: ["dl-md-linkmark"],
        title: `Language changed from ${a.lang || "none"} to ${b.lang || "none"}`,
      },
      children: [],
    };
    right.unshift(marker);
    merged.unshift(marker);
  }
  return { left: code(a, left), right: code(b, right), merged: code(b, merged), whole: false };
}

function row(node: TableRow, className?: string): TableRow {
  return className ? { ...node, data: { hProperties: { className: [className] } } } : node;
}

function cells(a: TableRow, b: TableRow): { left: TableRow; right: TableRow; merged: TableRow } {
  const width = Math.max(a.children.length, b.children.length);
  const left: TableRow = { ...a, children: [] };
  const right: TableRow = { ...b, children: [] };
  const merged: TableRow = { ...b, children: [] };
  for (let i = 0; i < width; i += 1) {
    const before = a.children[i];
    const after = b.children[i];
    const marks = inline(before?.children ?? [], after?.children ?? []);
    if (before) left.children.push({ ...before, children: marks.left });
    if (after) right.children.push({ ...after, children: marks.right });
    merged.children.push({
      ...(after ?? before ?? { type: "tableCell", children: [] }),
      children: marks.merged,
    });
  }
  return { left, right, merged };
}

type Visit<T> = {
  same: (before: T, after: T) => void;
  changed: (before: T, after: T) => void;
  removed: (node: T) => void;
  added: (node: T) => void;
};

function walk<T>(from: T[], to: T[], key: (node: T) => string, visit: Visit<T>): void {
  const changes = diffArrays(from.map(key), to.map(key));
  let l = 0;
  let r = 0;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (!change) continue;
    const count = change.count ?? change.value.length;
    if (!change.added && !change.removed) {
      for (let i = 0; i < count; i += 1) {
        const before = from[l + i];
        const after = to[r + i];
        if (before && after) visit.same(before, after);
      }
      l += count;
      r += count;
      continue;
    }
    const next = changes[index + 1];
    const removed = change.removed ? from.slice(l, l + count) : [];
    const nextCount = change.removed && next?.added ? (next.count ?? next.value.length) : 0;
    const added = change.added ? to.slice(r, r + count) : to.slice(r, r + nextCount);
    const paired = Math.min(removed.length, added.length);
    for (let i = 0; i < paired; i += 1) {
      const before = removed[i];
      const after = added[i];
      if (before && after) visit.changed(before, after);
    }
    for (const gone of removed.slice(paired)) visit.removed(gone);
    for (const fresh of added.slice(paired)) visit.added(fresh);
    l += removed.length;
    r += added.length;
    if (change.removed && next?.added) index += 1;
  }
}

function tableDiff(a: Table, b: Table, left: Block, right: Block): Marked {
  const key = (node: TableRow) => node.children.map(plain).join("\u0000");
  const out = { left: [] as TableRow[], right: [] as TableRow[], merged: [] as TableRow[] };
  walk(a.children, b.children, key, {
    same: (before, after) => {
      out.left.push(before);
      out.right.push(after);
      out.merged.push(after);
    },
    changed: (before, after) => {
      const marked = cells(before, after);
      out.left.push(marked.left);
      out.right.push(marked.right);
      out.merged.push(marked.merged);
    },
    removed: (gone) => {
      out.left.push(row(gone, "dl-md-row-del"));
      out.merged.push(row(gone, "dl-md-row-del"));
    },
    added: (fresh) => {
      out.right.push(row(fresh, "dl-md-row-ins"));
      out.merged.push(row(fresh, "dl-md-row-ins"));
    },
  });
  return {
    left: hast({ ...a, children: out.left }, left),
    right: hast({ ...b, children: out.right }, right),
    merged: hast(
      {
        ...b,
        align: (a.align?.length ?? 0) > (b.align?.length ?? 0) ? a.align : b.align,
        children: out.merged,
      },
      right,
    ),
    whole: false,
  };
}

type Sides = { left: RootContent; right: RootContent; merged: RootContent };

function tagged<T extends RootContent>(node: T, className: string): T {
  return { ...node, data: { ...node.data, hProperties: { className: [className] } } } as T;
}

function contentKey(node: RootContent): string {
  return JSON.stringify(withoutPositions(node));
}

function nested(a: RootContent, b: RootContent): Sides | null {
  if (a.type !== b.type) return null;
  const before = phrasing(a);
  const after = phrasing(b);
  if (before && after) {
    const marks = inline(before, after);
    return {
      left: withInline(a, marks.left),
      right: withInline(b, marks.right),
      merged: withInline(b, marks.merged),
    };
  }
  const containers = ["list", "listItem", "blockquote"];
  if (!containers.includes(a.type) || !containers.includes(b.type)) return null;
  if (a.type === "list" && b.type === "list" && a.ordered !== b.ordered) return null;
  const out = {
    left: [] as RootContent[],
    right: [] as RootContent[],
    merged: [] as RootContent[],
  };
  walk(
    (a as Parents).children as RootContent[],
    (b as Parents).children as RootContent[],
    contentKey,
    {
      same: (before, after) => {
        out.left.push(before);
        out.right.push(after);
        out.merged.push(after);
      },
      changed: (before, after) => {
        const inner = nested(before, after);
        if (inner) {
          out.left.push(inner.left);
          out.right.push(inner.right);
          out.merged.push(inner.merged);
        } else {
          out.left.push(tagged(before, "dl-md-row-del"));
          out.right.push(tagged(after, "dl-md-row-ins"));
          out.merged.push(tagged(before, "dl-md-row-del"), tagged(after, "dl-md-row-ins"));
        }
      },
      removed: (gone) => {
        out.left.push(tagged(gone, "dl-md-row-del"));
        out.merged.push(tagged(gone, "dl-md-row-del"));
      },
      added: (fresh) => {
        out.right.push(tagged(fresh, "dl-md-row-ins"));
        out.merged.push(tagged(fresh, "dl-md-row-ins"));
      },
    },
  );
  return {
    left: { ...a, children: out.left } as RootContent,
    right: { ...b, children: out.right } as RootContent,
    merged: { ...b, children: out.merged } as RootContent,
  };
}

export function markRow(entry: Row): Marked {
  const { left, right } = entry;
  if (entry.kind !== "modified" || !left || !right) {
    const shown = right ?? left;
    if (!shown) return { merged: { type: "root", children: [] }, whole: false };
    return {
      left: left ? hast(left.node, left) : undefined,
      right: right ? hast(right.node, right) : undefined,
      merged: hast(shown.node, shown),
      whole: false,
    };
  }
  const leftCode = htmlAsCode(left.node);
  const rightCode = htmlAsCode(right.node);
  if (leftCode.type === "code" && rightCode.type === "code") {
    return codeDiff(leftCode, rightCode);
  }
  if (left.node.type === "table" && right.node.type === "table") {
    return tableDiff(left.node, right.node, left, right);
  }
  const before = phrasing(leftCode);
  const after = phrasing(rightCode);
  if (before && after) {
    const marks = inline(before, after);
    return {
      left: hast(withInline(leftCode, marks.left), left),
      right: hast(withInline(rightCode, marks.right), right),
      merged: hast(withInline(rightCode as ListItem, marks.merged), right),
      whole: false,
    };
  }
  const inner = nested(leftCode, rightCode);
  if (inner) {
    return {
      left: hast(inner.left, left),
      right: hast(inner.right, right),
      merged: hast(inner.merged, right),
      whole: false,
    };
  }
  const leftTree = hast(left.node, left);
  const rightTree = hast(right.node, right);
  return {
    left: leftTree,
    right: rightTree,
    merged: { type: "root", children: [...leftTree.children, ...rightTree.children] },
    whole: true,
  };
}
