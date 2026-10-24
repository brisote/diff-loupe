import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blocks, parse } from "./blocks";
import { canRender, markdownRows, startsRun } from "./MarkdownDiff";
import { markRow } from "./mark";
import { match } from "./match";
import { render } from "./render";

function compare(before: string, after: string) {
  const rows = match(blocks(parse(before)), blocks(parse(after)));
  const html = (side: "left" | "right" | "merged", index: number) => {
    const row = rows[index];
    if (!row) throw new Error(`no row ${index}`);
    const tree = markRow(row)[side];
    return tree
      ? renderToStaticMarkup(<div>{render(tree, () => undefined)}</div>).slice(5, -6)
      : "";
  };
  return { kinds: rows.map((row) => row.kind), html, rows };
}

describe("markdown diff", () => {
  it("marks the words that changed in a paragraph", () => {
    const diff = compare(
      "# acme\n\nTotals are rounded half-up to two decimals.\n",
      "# acme\n\nTotals are rounded half-even to two decimals.\n",
    );
    expect(diff.kinds).toEqual(["equal", "modified"]);
    expect(diff.html("left", 1)).toBe(
      "<p>Totals are rounded <del>half-up</del> to two decimals.</p>",
    );
    expect(diff.html("right", 1)).toBe(
      "<p>Totals are rounded <ins>half-even</ins> to two decimals.</p>",
    );
    expect(diff.html("merged", 1)).toContain("<del>half-up</del> <ins>half-even</ins>");
  });

  it("shows an inserted list item as an inserted block", () => {
    const diff = compare(
      "- Currency follows the invoice.\n",
      "- Currency follows the invoice.\n- Empty invoices are skipped.\n",
    );
    expect(diff.kinds).toEqual(["equal", "inserted"]);
    expect(diff.html("right", 1)).toBe("<ul>\n<li>Empty invoices are skipped.</li>\n</ul>");
  });

  it("compares tables cell by cell and marks added rows", () => {
    const diff = compare(
      "| Field | Format |\n| --- | --- |\n| amount | 1234.5 |\n| customer | Name |\n",
      "| Field | Format |\n| --- | --- |\n| amount | 1234.50 |\n| customer | Name |\n| currency | ISO 4217 code |\n",
    );
    expect(diff.kinds).toEqual(["modified"]);
    expect(diff.html("left", 0)).toContain("<td><del>1234.5</del></td>");
    expect(diff.html("right", 0)).toContain("<td><ins>1234.50</ins></td>");
    expect(diff.html("right", 0)).toContain('<tr class="dl-md-row-ins">');
    expect(diff.html("merged", 0)).toContain("<del>1234.5</del> <ins>1234.50</ins>");
  });

  it("marks the changed part of a code block", () => {
    const diff = compare("```sh\nexport --all\n```\n", "```sh\nexport --skip-empty\n```\n");
    expect(diff.kinds).toEqual(["modified"]);
    expect(diff.html("left", 0)).toContain("export --<del>all</del>");
    expect(diff.html("right", 0)).toContain("export --<ins>skip-empty</ins>");
  });

  it("marks a renamed heading", () => {
    const diff = compare("## Export\n", "## Exporting invoices\n");
    expect(diff.kinds).toEqual(["modified"]);
    expect(diff.html("right", 0)).toBe("<h2><ins>Exporting invoices</ins></h2>");
  });

  it("shows a moved block as removed and added", () => {
    const diff = compare(
      "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n",
      "Second paragraph.\n\nThird paragraph.\n\nFirst paragraph.\n",
    );
    expect(diff.kinds).toEqual(["deleted", "equal", "equal", "inserted"]);
  });

  it("keeps the source lines of each block", () => {
    const diff = compare("# Title\n\nOne line\nand more\n", "# Title\n\nOne line\nand more!\n");
    expect(diff.rows[1]?.left?.lines).toEqual([3, 4]);
    expect(diff.rows[1]?.right?.lines).toEqual([3, 4]);
  });

  it("never renders scripts, event handlers or remote images", () => {
    const diff = compare(
      "Safe.\n",
      'Safe.\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n![logo](https://example.com/logo.png)\n\n[click](javascript:alert(3))\n',
    );
    const html = diff.rows.map((_, index) => diff.html("right", index)).join("\n");
    const page = document.createElement("div");
    page.innerHTML = html;
    expect(page.querySelectorAll("script, [onerror], img")).toHaveLength(0);
    expect(page.querySelectorAll("a")).toHaveLength(0);
    expect(page.querySelector(".dl-md-link")?.getAttribute("title")).toBeNull();
    expect(page.textContent).toContain("<script>alert(1)</script>");
    expect(html).toContain('title="Remote image not loaded: https://example.com/logo.png"');
  });

  it("flags a link whose address changed", () => {
    const diff = compare("See [export notes](docs/a.md).\n", "See [export notes](docs/b.md).\n");
    expect(diff.html("right", 0)).toContain(
      'class="dl-md-linkmark" title="Changed from docs/a.md"',
    );
  });

  it("numbers ordered list items and resolves reference links", () => {
    const diff = compare(
      "1. Install\n2. Configure\n3. Run\n\nSee [the notes][notes].\n\n[notes]: docs/notes.md\n",
      "1. Install\n2. Set up\n3. Run\n\nSee [the notes][notes].\n\n[notes]: docs/notes.md\n",
    );
    expect(diff.html("right", 1)).toContain('<ol start="2">');
    expect(diff.html("right", 2)).toContain('<ol start="3">');
    expect(diff.html("right", 3)).toContain(
      '<span class="dl-md-link" title="docs/notes.md">the notes</span>',
    );
  });

  it("pairs a large rewrite quickly", () => {
    const words = (seed: number) =>
      Array.from({ length: 800 }, (_, i) => `Paragraph ${seed}-${i} says something new.`).join(
        "\n\n",
      );
    const start = performance.now();
    compare(words(1), words(2));
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it("keeps strikethrough apart from removals and shows footnotes and front matter", () => {
    const diff = compare(
      "---\ntitle: Old\n---\n\nPrice ~~$10~~ $8.[^a]\n\n[^a]: Was ten.\n",
      "---\ntitle: New\n---\n\nPrice ~~$10~~ $8.[^a]\n\n[^a]: Was ten dollars.\n",
    );
    expect(diff.kinds).toEqual(["modified", "equal", "modified"]);
    expect(diff.html("right", 0)).toContain(
      '<pre><code class="language-yaml">title: <ins>New</ins>',
    );
    expect(diff.html("right", 1)).toBe("<p>Price <s>$10</s> $8.[^a]</p>");
    expect(diff.html("right", 2)).toContain("[^a]: Was <ins>ten dollars.</ins>");
  });

  it("marks a change of formatting and of code language", () => {
    const bold = compare("This is important.\n", "This is **important**.\n");
    expect(bold.html("right", 0)).toContain("<ins><strong>important</strong>.</ins>");
    const code = compare("```js\nlet a = 1\n```\n", "```ts\nlet a = 1\n```\n");
    expect(code.html("right", 0)).toContain('title="Language changed from js to ts"');
  });

  it("falls back to raw text for conflict markers and very large files", () => {
    const side = (text: string) => ({
      text,
      exists: true,
      crlf: false,
      encoding: "UTF-8",
      revision: null,
      title: null,
    });
    const diff = (left: string, right: string) => ({
      path: "README.md",
      oldPath: null,
      content: "text" as const,
      left: side(left),
      right: side(right),
      blocks: [],
    });
    expect(canRender(diff("# a\n", "# b\n"))).toBe(true);
    expect(canRender(diff("<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\n", "b\n"))).toBe(false);
    expect(canRender(diff("x".repeat(600_000), "y"))).toBe(false);
  });

  it("starts one placeholder for each run of added or removed blocks", () => {
    const { rows } = markdownRows(
      "# API\n\n## Rate limits\n\nOne hundred a minute.\n\n## Errors\n",
      "# API\n\n## Idempotency\n\nSend a key.\n\n- Keys expire.\n\n## Errors\n",
    );
    const kinds = rows.map((row) => row.kind);
    const starts = rows.flatMap((row, index) =>
      row.kind !== "equal" && row.kind !== "modified" && startsRun(rows, index) ? [row.kind] : [],
    );
    expect(kinds.filter((kind) => kind === "inserted").length).toBeGreaterThan(1);
    expect(kinds.filter((kind) => kind === "deleted").length).toBeGreaterThan(1);
    expect(starts).toEqual(["deleted", "inserted"]);
  });
});
