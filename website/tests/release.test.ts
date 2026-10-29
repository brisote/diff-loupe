import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../src/data/release.fixture.json";
import { installPs1Script, installScript } from "../src/lib/install";
import {
  compareVersions,
  debName,
  dmgName,
  fetchReleases,
  formatDate,
  formatSize,
  latestFor,
  latestRelease,
  newestFor,
  newestRelease,
  type PublishedRelease,
  parseLinuxRelease,
  parseRelease,
  parseReleaseList,
  parseWindowsRelease,
  releasedPlatforms,
  releases,
  resolveFixtureReleases,
  rpmName,
  setupName,
  type WindowsRelease,
} from "../src/lib/release";
import { getStaticPaths, GET as getVersion } from "../src/pages/download/latest/[platform]/version";
import { GET as getPs1 } from "../src/pages/install.ps1";
import { GET } from "../src/pages/install.sh";

const template = readFileSync(join(__dirname, "../src/install/install.sh"), "utf8");
const ps1Template = readFileSync(join(__dirname, "../src/install/install.ps1"), "utf8");
const sha256 = "3f1c9a7e5b2d4f6081a9c3e5d7f9b1a3c5e7092b4d6f8a1c3e5b7d9f0a2c4e6b";
const debSha256 = "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";
const rpmSha256 = "8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";
const dmgUrl = "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0.dmg";
const debUrl =
  "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0-linux-amd64.deb";
const rpmUrl =
  "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0-linux-x86_64.rpm";
const sumsUrl = `${dmgUrl}.sha256`;
const debSumsUrl = `${debUrl}.sha256`;
const rpmSumsUrl = `${rpmUrl}.sha256`;

function release(): PublishedRelease {
  return newestRelease(parseReleaseList(fixture.releases));
}

describe("parseReleaseList", () => {
  it("keeps published versions, newest first", () => {
    expect(parseReleaseList(fixture.releases).map((item) => [item.version, item.date])).toEqual([
      ["0.2.0", "2026-11-03T09:30:00Z"],
      ["0.1.0", "2026-10-12T14:00:00Z"],
    ]);
  });

  it("orders versions by number", () => {
    const [first] = fixture.releases;
    const list = ["v0.3.1", "v0.10.0", "v0.2.0"].map((tag_name) => ({ ...first, tag_name }));
    expect(parseReleaseList(list).map((item) => item.version)).toEqual([
      "0.10.0",
      "0.3.1",
      "0.2.0",
    ]);
  });

  it("leaves out drafts, pre-releases and tags that are not versions", () => {
    const [first] = fixture.releases;
    expect(
      parseReleaseList([
        { ...first, draft: true },
        { ...first, prerelease: true },
        { ...first, tag_name: "nightly" },
      ]),
    ).toEqual([]);
  });

  it("refuses a published version without a valid date", () => {
    const [first] = fixture.releases;
    expect(() => parseReleaseList([{ ...first, published_at: "soon" }])).toThrow("has no date");
    expect(() => parseReleaseList([{ ...first, published_at: null }])).toThrow("has no date");
  });

  it("refuses an answer that is not a list", () => {
    expect(() => parseReleaseList({ message: "Not Found" })).toThrow("are not a list");
  });

  it("refuses a repository without a release", () => {
    expect(() => newestRelease([])).toThrow("has no published release");
  });
});

describe("parseRelease and per-platform packages", () => {
  it("reads the version, date, disk image and checksum", () => {
    expect(parseRelease(release(), fixture.checksum)).toEqual({
      version: "0.2.0",
      date: "2026-11-03T09:30:00Z",
      dmg: { name: "Diffloupe-0.2.0.dmg", url: dmgUrl, size: 11812345, sha256 },
    });
  });

  it("reads the Linux .deb and .rpm packages and checksums", () => {
    expect(
      parseLinuxRelease(release(), {
        deb: fixture.checksums["Diffloupe-0.2.0-linux-amd64.deb"],
        rpm: fixture.checksums["Diffloupe-0.2.0-linux-x86_64.rpm"],
      }),
    ).toEqual({
      version: "0.2.0",
      date: "2026-11-03T09:30:00Z",
      deb: {
        name: debName("0.2.0"),
        url: debUrl,
        size: 10200000,
        sha256: debSha256,
      },
      rpm: {
        name: rpmName("0.2.0"),
        url: rpmUrl,
        size: 10400000,
        sha256: rpmSha256,
      },
    });
  });

  it("reads a Windows setup package and checksum", () => {
    const setupFile = setupName("0.2.0");
    const setupUrl = `https://github.com/brisote/diff-loupe/releases/download/v0.2.0/${setupFile}`;
    const withWin: PublishedRelease = {
      ...release(),
      assets: [
        ...release().assets,
        { name: setupFile, size: 13100000, browser_download_url: setupUrl },
      ],
    };
    expect(parseWindowsRelease(withWin, `${sha256}  ${setupFile}\n`)).toEqual({
      version: "0.2.0",
      date: "2026-11-03T09:30:00Z",
      setup: { name: setupFile, url: setupUrl, size: 13100000, sha256 },
    });
  });

  it("falls back per platform when a newer release only has a .dmg", async () => {
    const list = parseReleaseList(fixture.releases);
    const macOnly: PublishedRelease = {
      version: "0.2.1",
      date: "2026-11-04T09:30:00Z",
      assets: [
        {
          name: dmgName("0.2.1"),
          size: 11812345,
          browser_download_url:
            "https://github.com/brisote/diff-loupe/releases/download/v0.2.1/Diffloupe-0.2.1.dmg",
        },
        {
          name: `${dmgName("0.2.1")}.sha256`,
          size: 86,
          browser_download_url:
            "https://github.com/brisote/diff-loupe/releases/download/v0.2.1/Diffloupe-0.2.1.dmg.sha256",
        },
      ],
    };
    const combined = [macOnly, ...list];
    expect(newestFor(combined, "macos")?.version).toBe("0.2.1");
    expect(newestFor(combined, "linux")?.version).toBe("0.2.0");
    expect(newestFor(combined, "windows")).toBeUndefined();
  });

  it("lists only platforms that have a published release", async () => {
    const resolved = resolveFixtureReleases();
    expect(await releasedPlatforms(resolved)).toEqual(["macos", "linux"]);
    expect((await latestFor("macos", resolved))?.version).toBe("0.2.0");
    expect((await latestFor("linux", resolved))?.version).toBe("0.2.0");
    expect(await latestFor("windows", resolved)).toBeUndefined();
  });

  it("refuses a release without its disk image", () => {
    const assets = release().assets.filter((asset) => !asset.name.endsWith(".dmg"));
    expect(() => parseRelease({ ...release(), assets }, fixture.checksum)).toThrow(
      "has no Diffloupe-0.2.0.dmg",
    );
  });

  it("refuses a disk image from another repository", () => {
    const assets = release().assets.map((asset) => ({
      ...asset,
      browser_download_url: asset.browser_download_url.replace("brisote", "someone"),
    }));
    expect(() => parseRelease({ ...release(), assets }, fixture.checksum)).toThrow(
      "is not in brisote/diff-loupe",
    );
  });

  it("refuses a checksum file without the disk image's SHA-256 checksum", () => {
    expect(() => parseRelease(release(), "")).toThrow("no SHA-256 checksum");
    expect(() => parseRelease(release(), "abc  Diffloupe-0.2.0.dmg")).toThrow(
      "no SHA-256 checksum",
    );
    expect(() => parseRelease(release(), `${sha256}  Other.dmg`)).toThrow(
      "no SHA-256 checksum of Diffloupe-0.2.0.dmg",
    );
  });
});

describe("formats", () => {
  it("writes sizes in megabytes with one decimal", () => {
    expect(formatSize(11812345)).toBe("11.8 MB");
    expect(formatSize(9_960_000)).toBe("10.0 MB");
  });

  it("writes dates in UTC with the month spelt out", () => {
    expect(formatDate("2026-11-03T09:30:00Z")).toBe("November 3, 2026");
    expect(formatDate("2026-11-03T23:59:00Z")).toBe("November 3, 2026");
  });

  it("compares versions by number", () => {
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
  });
});

describe("the fixture", () => {
  it("gives the Download page and the Changelog the same latest release", async () => {
    expect((await latestRelease()).version).toBe("0.2.0");
    expect((await releases())[0]?.version).toBe("0.2.0");
  });
});

describe("fetchReleases", () => {
  const api = "https://api.github.com/repos/brisote/diff-loupe/releases?per_page=100";
  const second = `${api}&page=2`;

  function answer(routes: Record<string, string | number | [string, string]>) {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      const body = routes[url];
      if (body === undefined) throw new Error(`unexpected ${url}`);
      if (typeof body === "number") return new Response("", { status: body });
      const [text, link] = Array.isArray(body) ? body : [body, ""];
      return new Response(text, { status: 200, headers: link ? { Link: link } : {} });
    });
    return seen;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads every page of releases and the newest release's checksum files", async () => {
    const [newest, oldest] = fixture.releases;
    answer({
      [api]: [JSON.stringify([oldest]), `<${second}>; rel="next"`],
      [second]: JSON.stringify([newest]),
      [sumsUrl]: fixture.checksum,
      [debSumsUrl]: fixture.checksums["Diffloupe-0.2.0-linux-amd64.deb"],
      [rpmSumsUrl]: fixture.checksums["Diffloupe-0.2.0-linux-x86_64.rpm"],
    });
    const { list, latest, platforms } = await fetchReleases();
    expect(list.map((item) => item.version)).toEqual(["0.2.0", "0.1.0"]);
    expect(latest.dmg.sha256).toBe(sha256);
    expect(platforms.linux?.deb.sha256).toBe(debSha256);
    expect(platforms.linux?.rpm.sha256).toBe(rpmSha256);
    expect(platforms.windows).toBeUndefined();
  });

  it("sends the workflow's token to the API when it has one", async () => {
    vi.stubEnv("GITHUB_TOKEN", "token-for-the-test");
    const seen = answer({
      [api]: JSON.stringify(fixture.releases),
      [sumsUrl]: fixture.checksum,
      [debSumsUrl]: fixture.checksums["Diffloupe-0.2.0-linux-amd64.deb"],
      [rpmSumsUrl]: fixture.checksums["Diffloupe-0.2.0-linux-x86_64.rpm"],
    });
    await fetchReleases();
    expect(seen[0]?.headers.Authorization).toBe("Bearer token-for-the-test");
  });

  it("fails when the newest release has no checksum file", async () => {
    const [newest] = fixture.releases;
    const assets = newest?.assets.slice(0, 1);
    answer({ [api]: JSON.stringify([{ ...newest, assets }]) });
    await expect(fetchReleases()).rejects.toThrow("has no Diffloupe-0.2.0.dmg.sha256");
  });

  it("fails when GitHub does not answer", async () => {
    answer({ [api]: 503 });
    await expect(fetchReleases()).rejects.toThrow("answered 503");
  });
});

describe("installScript", () => {
  it("writes the fixture's macOS and Linux versions, URLs and checksums into the script", async () => {
    const script = installScript(template, await latestRelease(), await latestFor("linux"));
    expect(script).toContain('version="0.2.0"');
    expect(script).toContain(`url="${dmgUrl}"`);
    expect(script).toContain(`checksum="${sha256}"`);
    expect(script).toContain(`deb_url="${debUrl}"`);
    expect(script).toContain(`deb_checksum="${debSha256}"`);
    expect(script).toContain(`rpm_url="${rpmUrl}"`);
    expect(script).toContain(`rpm_checksum="${rpmSha256}"`);
    expect(script).not.toMatch(/@[A-Z0-9_]+@/);
  });

  it("refuses a value that could break out of its quotes", async () => {
    const latest = await latestRelease();
    const dmg = { ...latest.dmg, url: 'https://github.com/"$(rm -rf ~)"' };
    expect(() => installScript(template, { ...latest, dmg })).toThrow("cannot go into install.sh");
  });

  it("refuses a template with an unknown placeholder", async () => {
    const latest = await latestRelease();
    expect(() => installScript("@NAME@", latest)).toThrow("unknown placeholder");
  });
});

describe("installPs1Script", () => {
  it("writes the Windows version, setup URL and checksum into the script", () => {
    const release: WindowsRelease = {
      version: "0.4.0",
      date: "2026-11-03T09:30:00Z",
      setup: {
        name: "Diffloupe-0.4.0-windows-x64-setup.exe",
        url: "https://github.com/brisote/diff-loupe/releases/download/v0.4.0/Diffloupe-0.4.0-windows-x64-setup.exe",
        size: 10500000,
        sha256: "4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e",
      },
    };
    const script = installPs1Script(ps1Template, release);
    expect(script).toContain('$version = "0.4.0"');
    expect(script).toContain(
      '$url = "https://github.com/brisote/diff-loupe/releases/download/v0.4.0/Diffloupe-0.4.0-windows-x64-setup.exe"',
    );
    expect(script).toContain(
      '$checksum = "4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e"',
    );
    expect(script).not.toMatch(/@[A-Z0-9_]+@/);
  });

  it("refuses a value with invalid characters", () => {
    const release: WindowsRelease = {
      version: "0.4.0",
      date: "2026-11-03T09:30:00Z",
      setup: {
        name: "setup.exe",
        url: 'https://evil.com/setup.exe"; Remove-Item C:\\ -Recurse -Force #',
        size: 10500000,
        sha256: "00",
      },
    };
    expect(() => installPs1Script(ps1Template, release)).toThrow("cannot go into install.ps1");
  });

  it("leaves empty strings when no Windows release is passed", () => {
    const script = installPs1Script(ps1Template);
    expect(script).toContain('$version = ""');
    expect(script).toContain('$url = ""');
    expect(script).toContain('$checksum = ""');
    expect(script).not.toMatch(/@[A-Z0-9_]+@/);
  });
});

describe("the install.sh, install.ps1 and version endpoints", () => {
  it("serves the filled script as plain text", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const script = await response.text();
    expect(script).toContain('version="0.2.0"');
    expect(script).toContain(`deb_url="${debUrl}"`);
    expect(script.trimEnd().endsWith("install_diffloupe")).toBe(true);
  });

  it("serves install.ps1 as plain text", async () => {
    const response = await getPs1({} as Parameters<typeof getPs1>[0]);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const script = await response.text();
    expect(script).toContain("Downloading Diffloupe");
    expect(script).toContain("Diffloupe was not installed");
  });

  it("generates version files only for platforms that have a release", async () => {
    const paths = await getStaticPaths({} as Parameters<typeof getStaticPaths>[0]);
    expect(paths.map((item) => item.params.platform)).toEqual(["macos", "linux"]);
    const macosRes = await getVersion({
      params: { platform: "macos" },
      props: { version: "0.2.0" },
    } as unknown as Parameters<typeof getVersion>[0]);
    expect(await macosRes.text()).toBe("0.2.0\n");
    const linuxRes = await getVersion({
      params: { platform: "linux" },
      props: { version: "0.2.0" },
    } as unknown as Parameters<typeof getVersion>[0]);
    expect(await linuxRes.text()).toBe("0.2.0\n");
  });
});
