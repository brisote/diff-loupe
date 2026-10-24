import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changelogEntries,
  changelogHeadings,
  changelogSections,
  firstPublicVersion,
  renderMarkdown,
  sectionProblems,
} from "../src/lib/changelog";

const changelog = readFileSync(join(__dirname, "../../CHANGELOG.md"), "utf8");
const fixture = readFileSync(join(__dirname, "../src/data/changelog.fixture.md"), "utf8");

describe("changelogSections", () => {
  it("keeps the versions from the first public version on, newest first", () => {
    const text =
      "# Changelog\n\n## 0.1.0\n\nOld.\n\n## 0.10.0\n\nTen.\n\n## 0.2.0\n\nTwo.\n\n## 0.3.1\n\nThree.\n";
    expect(changelogSections(text).map((section) => section.version)).toEqual([
      "0.10.0",
      "0.3.1",
      "0.2.0",
    ]);
  });

  it("takes each section's text up to the next version", () => {
    const [section] = changelogSections(fixture);
    expect(section?.version).toBe("0.2.0");
    expect(section?.markdown.startsWith("The first public release.")).toBe(true);
    expect(section?.markdown).not.toContain("0.1.0");
  });

  it("starts at 0.2.0 and ignores headings that are not versions", () => {
    expect(firstPublicVersion).toBe("0.2.0");
    const text = "## Unreleased\n\nSoon.\n\n## 0.3.0 (2026-12-01)\n\nDated.\n\n## 0.2.0\n\nTwo.\n";
    expect(changelogSections(text).map((section) => section.version)).toEqual(["0.2.0"]);
  });

  it("keeps a heading inside a code block as part of its section", () => {
    const text = "## 0.3.0\n\nThree.\n\n```md\n## 0.0.1\n```\n\n## 0.2.0\n\nTwo.\n";
    const [three] = changelogSections(text);
    expect(three?.markdown).toBe("Three.\n\n```md\n## 0.0.1\n```");
  });
});

describe("CHANGELOG.md", () => {
  it("has a bare version in every section heading", () => {
    for (const heading of changelogHeadings(changelog)) expect(heading).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("sectionProblems", () => {
  it("accepts a summary sentence followed by groups", () => {
    expect(
      sectionProblems({ version: "0.2.0", markdown: "The first.\n\n### Git\n\n- One." }),
    ).toEqual([]);
  });

  it("finds a section without a summary, without groups or with AI wording", () => {
    expect(sectionProblems({ version: "0.2.0", markdown: "### Git\n\n- One." })).toEqual([
      "it does not open with a summary sentence",
    ]);
    expect(sectionProblems({ version: "0.2.0", markdown: "The first.\n\n- One." })).toEqual([
      "it has no ### group",
    ]);
    expect(
      sectionProblems({ version: "0.2.0", markdown: "Explain with AI.\n\n### Git\n\n- One." }),
    ).toEqual(["it mentions AI"]);
    expect(
      sectionProblems({ version: "0.2.0", markdown: "Agents help.\n\n### Git\n\n- One." }),
    ).toEqual(["it mentions AI"]);
    expect(
      sectionProblems({ version: "0.2.0", markdown: "Sum.\n\n### Git\n\n- [x](javascript:void)." }),
    ).toEqual(["it has a link that is not https"]);
  });

  it("finds nothing wrong in the public sections of CHANGELOG.md", () => {
    for (const section of changelogSections(changelog))
      expect(sectionProblems(section), section.version).toEqual([]);
  });

  it("finds nothing wrong in the fixture", () => {
    for (const section of changelogSections(fixture))
      expect(sectionProblems(section), section.version).toEqual([]);
  });
});

describe("renderMarkdown", () => {
  it("renders tables like Astro's own Markdown", async () => {
    expect(await renderMarkdown("| a |\n| - |\n| b |\n")).toContain("<table>");
  });

  it("renders paragraphs, groups, lists and code without heading ids", async () => {
    expect(await renderMarkdown("Sum.\n\n### Git\n\n- Run `git push`.\n")).toBe(
      "<p>Sum.</p>\n<h3>Git</h3>\n<ul>\n<li>Run <code>git push</code>.</li>\n</ul>",
    );
  });
});

describe("changelogEntries", () => {
  const text =
    "## 0.3.0\n\nThree.\n\n### Git\n\n- A.\n\n## 0.2.1\n\nNot out.\n\n### Git\n\n- B.\n\n## 0.2.0\n\nTwo.\n\n### Git\n\n- C.\n";
  const base = "https://github.com/brisote/diff-loupe/releases/download";
  const published = (versions: string[]) =>
    Promise.resolve(
      versions.map((version) => ({
        version,
        date: "2026-11-03T09:30:00Z",
        assets: [
          {
            name: `Diffloupe-${version}.dmg`,
            size: 1,
            browser_download_url: `${base}/v${version}/Diffloupe-${version}.dmg`,
          },
        ],
      })),
    );

  it("shows released versions newest first and marks the latest release", async () => {
    const entries = await changelogEntries(
      text,
      published(["0.3.0", "0.2.0"]),
      Promise.resolve("0.3.0"),
    );
    expect(entries.map((entry) => [entry.version, entry.latest, entry.dmg])).toEqual([
      ["0.3.0", true, `${base}/v0.3.0/Diffloupe-0.3.0.dmg`],
      ["0.2.0", false, `${base}/v0.2.0/Diffloupe-0.2.0.dmg`],
    ]);
    expect(entries[0]?.html).toBe("<p>Three.</p>\n<h3>Git</h3>\n<ul>\n<li>A.</li>\n</ul>");
  });

  it("marks the release GitHub serves as latest, even when a newer section exists", async () => {
    const entries = await changelogEntries(
      text,
      published(["0.3.0", "0.2.0"]),
      Promise.resolve("0.2.0"),
    );
    expect(entries.map((entry) => entry.latest)).toEqual([false, true]);
  });

  it("leaves out a version that has no release yet", async () => {
    const entries = await changelogEntries(
      text,
      published(["0.3.0", "0.2.0"]),
      Promise.resolve("0.3.0"),
    );
    expect(entries.map((entry) => entry.version)).not.toContain("0.2.1");
  });

  it("fails on a release without its disk image", async () => {
    const broken = Promise.resolve([
      { version: "0.2.0", date: "2026-11-03T09:30:00Z", assets: [] },
    ]);
    await expect(changelogEntries(text, broken, Promise.resolve("0.2.0"))).rejects.toThrow(
      "has no Diffloupe-0.2.0.dmg",
    );
  });

  it("fails on a released section that breaks the rules", async () => {
    await expect(
      changelogEntries(
        "## 0.2.0\n\n- No summary.\n",
        published(["0.2.0"]),
        Promise.resolve("0.2.0"),
      ),
    ).rejects.toThrow(
      "The CHANGELOG.md section 0.2.0: it does not open with a summary sentence, it has no ### group.",
    );
  });

  it("builds the fixture page with one public release", async () => {
    expect((await changelogEntries()).map((entry) => [entry.version, entry.latest])).toEqual([
      ["0.2.0", true],
    ]);
  });
});
