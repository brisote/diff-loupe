import type { Element, ElementContent, Root } from "hast";
import { defaultSchema, type Schema, sanitize } from "hast-util-sanitize";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

const schema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "span"],
  attributes: {
    ...defaultSchema.attributes,
    span: ["className", "title"],
    del: ["className"],
    ins: ["className"],
    tr: ["className"],
    img: [...(defaultSchema.attributes?.img ?? []), "title"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
};

export type Images = (source: string) => string | null | undefined;

export function isRemote(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("//");
}

function imageless(node: Element, source: string, reason: string): Element {
  const alt = typeof node.properties.alt === "string" ? node.properties.alt : "";
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["dl-md-image-off"], title: `${reason}: ${source}` },
    children: [{ type: "text", value: alt ? `[${alt}]` : "[image]" }],
  };
}

function withImages(children: ElementContent[], images: Images): ElementContent[] {
  return children.map((child) => {
    if (child.type !== "element") return child;
    if (child.tagName === "img") {
      const source = String(child.properties.src ?? "");
      if (source.startsWith("data:")) return child;
      if (isRemote(source)) return imageless(child, source, "Remote image not loaded");
      const loaded = images(source);
      if (loaded) return { ...child, properties: { ...child.properties, src: loaded } };
      return imageless(child, source, loaded === null ? "Image not found" : "Loading image");
    }
    return { ...child, children: withImages(child.children, images) };
  });
}

function Link(props: { href?: string; children?: ReactNode }) {
  return (
    <span className="dl-md-link" title={props.href}>
      {props.children}
    </span>
  );
}

export function render(tree: Root, images: Images): ReactNode {
  const clean = sanitize(
    { ...tree, children: withImages(tree.children as ElementContent[], images) },
    schema,
  );
  return toJsxRuntime(clean, { Fragment, jsx, jsxs, components: { a: Link } });
}

export function sources(tree: Root): string[] {
  const found: string[] = [];
  const walk = (nodes: Root["children"]) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      if (node.tagName === "img") {
        const source = String(node.properties.src ?? "");
        if (source && !isRemote(source)) found.push(source);
      }
      walk(node.children);
    }
  };
  walk(tree.children);
  return found;
}
