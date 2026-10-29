import { readFileSync } from "node:fs";
import { compareVersions, type Releases, resolveFixtureReleases } from "../src/lib/release";
import { liveReleases, siteUrl } from "./live";

export { siteUrl };

const known: Releases = siteUrl
  ? JSON.parse(readFileSync(liveReleases, "utf8"))
  : resolveFixtureReleases();

const changelog = readFileSync(
  new URL(siteUrl ? "../../CHANGELOG.md" : "../src/data/changelog.fixture.md", import.meta.url),
  "utf8",
);

export const latest = known.latest;
export const latestLinux = known.platforms.linux;
export const latestWindows = known.platforms.windows;
export const published = known.list.filter(
  (release) =>
    compareVersions(release.version, "0.2.0") >= 0 &&
    changelog.includes(`\n## ${release.version}\n`),
);

export function groups(version: string): string[] {
  const section = changelog.split(/^## /m).find((part) => part.startsWith(`${version}\n`)) ?? "";
  return [...section.matchAll(/^### (.+)$/gm)].map((match) => match[1] ?? "");
}
