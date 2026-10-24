import type { Heading, Root } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import changelog from "../../../CHANGELOG.md?raw";
import fixture from "../data/changelog.fixture.md?raw";
import {
  compareVersions,
  dmgName,
  isVersion,
  latestRelease,
  live,
  type PublishedRelease,
  releaseAsset,
  releases,
} from "./release";

export const firstPublicVersion = "0.2.0";

export interface ChangelogSection {
  version: string;
  markdown: string;
}

function allSections(text: string): ChangelogSection[] {
  const tree = unified().use(remarkParse).parse(text) as Root;
  const headings = tree.children.filter(
    (node): node is Heading => node.type === "heading" && node.depth === 2,
  );
  return headings.map((heading, index) => {
    const start = heading.position?.end.offset ?? 0;
    const end = headings[index + 1]?.position?.start.offset ?? text.length;
    const title = text.slice(heading.position?.start.offset, start).replace(/^##\s+/, "");
    return { version: title.trim(), markdown: text.slice(start, end).trim() };
  });
}

export function changelogHeadings(text: string): string[] {
  return allSections(text).map((section) => section.version);
}

export function changelogSections(text: string): ChangelogSection[] {
  return allSections(text)
    .filter(
      (section) =>
        isVersion(section.version) && compareVersions(section.version, firstPublicVersion) >= 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function sectionProblems(section: ChangelogSection): string[] {
  const problems: string[] = [];
  const [summary = ""] = section.markdown.split(/\n\s*\n/);
  if (!summary || /^[#-]/.test(summary)) problems.push("it does not open with a summary sentence");
  if (!/^### \S/m.test(section.markdown)) problems.push("it has no ### group");
  if (/\b(AI|Claude|agents?)\b/i.test(section.markdown)) problems.push("it mentions AI");
  if (/\]\((?!https:\/\/|\/|#)/.test(section.markdown))
    problems.push("it has a link that is not https");
  return problems;
}

export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

export interface ChangelogEntry {
  version: string;
  date: string;
  dmg: string;
  html: string;
  latest: boolean;
}

export async function changelogEntries(
  text = live() ? changelog : fixture,
  published: Promise<PublishedRelease[]> = releases(),
  latest: Promise<string> = latestRelease().then((release) => release.version),
): Promise<ChangelogEntry[]> {
  const [list, newest] = await Promise.all([published, latest]);
  const entries: ChangelogEntry[] = [];
  for (const section of changelogSections(text)) {
    const release = list.find((item) => item.version === section.version);
    if (!release) continue;
    const problems = sectionProblems(section);
    if (problems.length)
      throw new Error(`The CHANGELOG.md section ${section.version}: ${problems.join(", ")}.`);
    entries.push({
      version: release.version,
      date: release.date,
      dmg: releaseAsset(release, dmgName(release.version)).browser_download_url,
      html: await renderMarkdown(section.markdown),
      latest: release.version === newest,
    });
  }
  return entries;
}
