import { describe, expect, it } from "vitest";
import { boardHtml, boardName } from "../e2e/design";

const board = `<!doctype html><html><head><script src="./support.js"></script></head><body><x-dc>
<helmet><style>body{margin:0}</style></helmet>
<div class="site" data-theme="{{theme}}"><img src="/_blob/0123456789abcdef0123456789abcdef"></div>
</x-dc><script type="text/x-dc">class Component {}</script></body></html>`;

describe("boardHtml", () => {
  it("fills in the theme and keeps the board's own style", () => {
    const html = boardHtml(board, "dark");
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("<style>body{margin:0}</style>");
    expect(html).not.toContain("{{theme}}");
  });

  it("serves uploaded files from the design folder and drops the canvas runtime", () => {
    const html = boardHtml(board, "light");
    expect(html).toContain('src="/__design/files/0123456789abcdef0123456789abcdef"');
    expect(html).not.toContain("support.js");
    expect(html).not.toContain("x-dc");
  });
});

describe("boardName", () => {
  it("picks the phone board below 768 px", () => {
    expect(boardName("Download", 390)).toBe("DownloadPhone");
    expect(boardName("Download", 1440)).toBe("Download");
  });
});
