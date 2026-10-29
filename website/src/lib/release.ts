import fixture from "../data/release.fixture.json" with { type: "json" };

export const repository = "brisote/diff-loupe";

export const platforms = ["macos", "windows", "linux"] as const;
export type Platform = (typeof platforms)[number];

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

export interface PackageFile {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface MacosRelease {
  version: string;
  date: string;
  dmg: PackageFile;
}

export interface LinuxRelease {
  version: string;
  date: string;
  deb: PackageFile;
  rpm: PackageFile;
}

export interface WindowsRelease {
  version: string;
  date: string;
  setup: PackageFile;
}

export interface PlatformReleaseMap {
  macos: MacosRelease;
  linux: LinuxRelease;
  windows: WindowsRelease;
}

export type Release = MacosRelease;

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

export function debName(version: string): string {
  return `Diffloupe-${version}-linux-amd64.deb`;
}

export function rpmName(version: string): string {
  return `Diffloupe-${version}-linux-x86_64.rpm`;
}

export function setupName(version: string): string {
  return `Diffloupe-${version}-windows-x64-setup.exe`;
}

export function platformFiles(platform: Platform, version: string): string[] {
  if (platform === "macos") return [dmgName(version)];
  if (platform === "linux") return [debName(version), rpmName(version)];
  return [setupName(version)];
}

export function hasPlatform(release: PublishedRelease, platform: Platform): boolean {
  const names = new Set(release.assets.map((asset) => asset.name));
  return platformFiles(platform, release.version).every(
    (file) => names.has(file) && names.has(`${file}.sha256`),
  );
}

export function newestFor(
  list: PublishedRelease[],
  platform: Platform,
): PublishedRelease | undefined {
  return list.find((release) => hasPlatform(release, platform));
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

export function parsePackage(
  release: PublishedRelease,
  name: string,
  checksum: string,
): PackageFile {
  const asset = releaseAsset(release, name);
  if (!(asset.size > 0)) throw new Error(`The ${asset.name} of the latest release has no size.`);
  const [sha256 = "", file] = checksum.trim().split(/\s+/);
  if (!/^[0-9a-f]{64}$/.test(sha256) || file !== asset.name)
    throw new Error(
      `The .sha256 file of the latest release holds no SHA-256 checksum of ${asset.name}.`,
    );
  return { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256 };
}

export function parseRelease(release: PublishedRelease, checksum: string): Release {
  return {
    version: release.version,
    date: release.date,
    dmg: parsePackage(release, dmgName(release.version), checksum),
  };
}

export function parseLinuxRelease(
  release: PublishedRelease,
  checksums: { deb: string; rpm: string },
): LinuxRelease {
  return {
    version: release.version,
    date: release.date,
    deb: parsePackage(release, debName(release.version), checksums.deb),
    rpm: parsePackage(release, rpmName(release.version), checksums.rpm),
  };
}

export function parseWindowsRelease(release: PublishedRelease, checksum: string): WindowsRelease {
  return {
    version: release.version,
    date: release.date,
    setup: parsePackage(release, setupName(release.version), checksum),
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

export interface Releases {
  list: PublishedRelease[];
  latest: Release;
  platforms: {
    macos: MacosRelease;
    linux?: LinuxRelease;
    windows?: WindowsRelease;
  };
}

async function fetchChecksum(release: PublishedRelease, file: string): Promise<string> {
  const asset = releaseAsset(release, `${file}.sha256`);
  return (await fetchFrom(asset.browser_download_url)).text();
}

export async function fetchReleases(): Promise<Releases> {
  const list = parseReleaseList(await fetchReleaseList());
  const macosRelease = newestFor(list, "macos") ?? newestRelease(list);
  const macos = parseRelease(
    macosRelease,
    await fetchChecksum(macosRelease, dmgName(macosRelease.version)),
  );
  const linuxRelease = newestFor(list, "linux");
  const linux = linuxRelease
    ? parseLinuxRelease(linuxRelease, {
        deb: await fetchChecksum(linuxRelease, debName(linuxRelease.version)),
        rpm: await fetchChecksum(linuxRelease, rpmName(linuxRelease.version)),
      })
    : undefined;
  const windowsRelease = newestFor(list, "windows");
  const windows = windowsRelease
    ? parseWindowsRelease(
        windowsRelease,
        await fetchChecksum(windowsRelease, setupName(windowsRelease.version)),
      )
    : undefined;
  return { list, latest: macos, platforms: { macos, linux, windows } };
}

export function live(): boolean {
  return process.env.DIFFLOUPE_RELEASE === "live";
}

function fixtureChecksum(file: string): string {
  const sums = (fixture as { checksums?: Record<string, string> }).checksums ?? {};
  const found = sums[file] ?? (file === "Diffloupe-0.2.0.dmg" ? fixture.checksum : undefined);
  if (!found) throw new Error(`The fixture has no checksum for ${file}.`);
  return found;
}

export function resolveFixtureReleases(raw: unknown = fixture.releases): Releases {
  const list = parseReleaseList(raw);
  const macosRelease = newestFor(list, "macos") ?? newestRelease(list);
  const macos = parseRelease(macosRelease, fixtureChecksum(dmgName(macosRelease.version)));
  const linuxRelease = newestFor(list, "linux");
  const linux = linuxRelease
    ? parseLinuxRelease(linuxRelease, {
        deb: fixtureChecksum(debName(linuxRelease.version)),
        rpm: fixtureChecksum(rpmName(linuxRelease.version)),
      })
    : undefined;
  const windowsRelease = newestFor(list, "windows");
  const windows = windowsRelease
    ? parseWindowsRelease(windowsRelease, fixtureChecksum(setupName(windowsRelease.version)))
    : undefined;
  return { list, latest: macos, platforms: { macos, linux, windows } };
}

let loaded: Promise<Releases> | undefined;

function load(): Promise<Releases> {
  loaded ??= live() ? fetchReleases() : Promise.resolve(resolveFixtureReleases());
  return loaded;
}

export async function latestRelease(): Promise<Release> {
  return (await load()).latest;
}

export async function latestFor<P extends Platform>(
  platform: P,
  source?: Releases,
): Promise<PlatformReleaseMap[P] | undefined> {
  const resolved = source ?? (await load());
  return resolved.platforms[platform] as PlatformReleaseMap[P] | undefined;
}

export async function releasedPlatforms(source?: Releases): Promise<Platform[]> {
  const resolved = source ?? (await load());
  return platforms.filter((platform) => Boolean(resolved.platforms[platform]));
}

export async function releases(): Promise<PublishedRelease[]> {
  return (await load()).list;
}
