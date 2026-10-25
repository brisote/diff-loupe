import fixture from "../data/release.fixture.json" with { type: "json" };

export const repository = "brisote/diff-loupe";

export interface Asset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface PublishedRelease {
  version: string;
  date: string;
  assets: Asset[];
}

export interface Release {
  version: string;
  date: string;
  dmg: { name: string; url: string; size: number; sha256: string };
}

interface GitHubRelease {
  tag_name?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Asset[];
}

export function isVersion(text: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(text);
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function dmgName(version: string): string {
  return `Diffloupe-${version}.dmg`;
}

export function releaseAsset(release: PublishedRelease, name: string): Asset {
  const found = release.assets.find((item) => item.name === name);
  if (!found) throw new Error(`The release ${release.version} of ${repository} has no ${name}.`);
  if (!found.browser_download_url.startsWith(`https://github.com/${repository}/releases/download/`))
    throw new Error(`The ${name} of the release ${release.version} is not in ${repository}.`);
  return found;
}

export function parseReleaseList(list: unknown): PublishedRelease[] {
  if (!Array.isArray(list)) throw new Error(`The releases of ${repository} are not a list.`);
  return list
    .flatMap((item: GitHubRelease) => {
      const version = item.tag_name?.replace(/^v/, "") ?? "";
      if (item.draft || item.prerelease || !isVersion(version)) return [];
      if (!item.published_at || Number.isNaN(Date.parse(item.published_at)))
        throw new Error(`The release ${version} of ${repository} has no date.`);
      return [{ version, date: item.published_at, assets: item.assets ?? [] }];
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

export function newestRelease(list: PublishedRelease[]): PublishedRelease {
  const [newest] = list;
  if (!newest) throw new Error(`${repository} has no published release.`);
  return newest;
}

export function parseRelease(release: PublishedRelease, checksum: string): Release {
  const dmg = releaseAsset(release, dmgName(release.version));
  if (!(dmg.size > 0)) throw new Error(`The ${dmg.name} of the latest release has no size.`);
  const [sha256 = "", file] = checksum.trim().split(/\s+/);
  if (!/^[0-9a-f]{64}$/.test(sha256) || file !== dmg.name)
    throw new Error(
      `The .sha256 file of the latest release holds no SHA-256 checksum of ${dmg.name}.`,
    );
  return {
    version: release.version,
    date: release.date,
    dmg: { name: dmg.name, url: dmg.browser_download_url, size: dmg.size, sha256 },
  };
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function fetchFrom(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response;
}

function nextPage(response: Response): string | undefined {
  return response.headers.get("Link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
}

export async function fetchReleaseList(): Promise<unknown[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const list: unknown[] = [];
  let url: string | undefined = `https://api.github.com/repos/${repository}/releases?per_page=100`;
  while (url) {
    const response = await fetchFrom(url, headers);
    list.push(...(await response.json()));
    url = nextPage(response);
  }
  return list;
}

interface Releases {
  list: PublishedRelease[];
  latest: Release;
}

export async function fetchReleases(): Promise<Releases> {
  const list = parseReleaseList(await fetchReleaseList());
  const newest = newestRelease(list);
  const checksum = releaseAsset(newest, `${dmgName(newest.version)}.sha256`);
  const text = await (await fetchFrom(checksum.browser_download_url)).text();
  return { list, latest: parseRelease(newest, text) };
}

export function live(): boolean {
  return process.env.DIFFLOUPE_RELEASE === "live";
}

function fixtureReleases(): Releases {
  const list = parseReleaseList(fixture.releases);
  return { list, latest: parseRelease(newestRelease(list), fixture.checksum) };
}

let loaded: Promise<Releases> | undefined;

function load(): Promise<Releases> {
  loaded ??= live() ? fetchReleases() : Promise.resolve(fixtureReleases());
  return loaded;
}

export async function latestRelease(): Promise<Release> {
  return (await load()).latest;
}

export async function releases(): Promise<PublishedRelease[]> {
  return (await load()).list;
}
