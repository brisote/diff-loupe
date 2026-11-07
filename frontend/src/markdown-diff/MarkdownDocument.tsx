import type { Root as HastRoot } from "hast";
import { toHast } from "mdast-util-to-hast";
import type { ReactNode } from "react";
import { parse } from "./blocks";
import { htmlAsCode } from "./mark";
import { render } from "./render";

export function renderMarkdown(markdown: string): ReactNode {
  const mdast = parse(markdown);
  const children = mdast.children.map(htmlAsCode);
  const hast = toHast(
    { type: "root", children },
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
  const tree = (hast.type === "root" ? hast : { type: "root", children: [hast] }) as HastRoot;
  return render(tree, () => null);
}

export function MarkdownDocument({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={`dl-md${className ? ` ${className}` : ""}`}>{renderMarkdown(markdown)}</div>
  );
}
