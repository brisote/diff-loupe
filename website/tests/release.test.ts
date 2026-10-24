import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../src/data/release.fixture.json";
import { installScript } from "../src/lib/install";
import {
  compareVersions,
  fetchReleases,
  formatDate,
  formatSize,
  latestRelease,
  newestRelease,
  type PublishedRelease,
  parseRelease,
  parseReleaseList,
  releases,
} from "../src/lib/release";
import { GET } from "../src/pages/install.sh";

const template = readFileSync(join(__dirname, "../src/install/install.sh"), "utf8");
const sha256 = "3f1c9a7e5b2d4f6081a9c3e5d7f9b1a3c5e7092b4d6f8a1c3e5b7d9f0a2c4e6b";
const dmgUrl = "https://github.com/brisote/diff-loupe/releases/download/v0.2.0/Diffloupe-0.2.0.dmg";
const sumsUrl = `${dmgUrl}.sha256`;

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

describe("parseRelease", () => {
  it("reads the version, date, disk image and checksum", () => {
    expect(parseRelease(release(), fixture.checksum)).toEqual({
      version: "0.2.0",
      date: "2026-11-03T09:30:00Z",
      dmg: { name: "Diffloupe-0.2.0.dmg", url: dmgUrl, size: 11812345, sha256 },
    });
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

  it("reads every page of releases and the newest one's checksum file", async () => {
    const [newest, oldest] = fixture.releases;
    answer({
      [api]: [JSON.stringify([oldest]), `<${second}>; rel="next"`],
      [second]: JSON.stringify([newest]),
      [sumsUrl]: fixture.checksum,
    });
    const { list, latest } = await fetchReleases();
    expect(list.map((item) => item.version)).toEqual(["0.2.0", "0.1.0"]);
    expect(latest.dmg.sha256).toBe(sha256);
  });

  it("sends the workflow's token to the API when it has one", async () => {
    vi.stubEnv("GITHUB_TOKEN", "token-for-the-test");
    const seen = answer({ [api]: JSON.stringify(fixture.releases), [sumsUrl]: fixture.checksum });
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
  it("writes the fixture's version, URL and checksum into the script", async () => {
    const script = installScript(template, await latestRelease());
    expect(script).toContain('version="0.2.0"');
    expect(script).toContain(`url="${dmgUrl}"`);
    expect(script).toContain(`checksum="${sha256}"`);
    expect(script).not.toMatch(/@[A-Z0-9]+@/);
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

describe("the install.sh endpoint", () => {
  it("serves the filled script as plain text", async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const script = await response.text();
    expect(script).toContain('version="0.2.0"');
    expect(script.trimEnd().endsWith("install_diffloupe")).toBe(true);
  });
});
